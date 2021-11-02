/**
 * @module spline_editor Spline editor custom HTML element.
 */
import {Api} from "/static/js/api.js";
import {subtract_arrays, array_reshape, multiply_scalar, array_shape } from "/static/js/array.js";
import {BBox} from "/static/js/bbox.js";
import {toggle_button, switch_button_on, switch_button_off, is_checked, enable_button, disable_button, switch_button_to} from "/static/js/button.js";
import {INTERVAL} from "/static/js/config.js";
import {make_draggable} from "/static/js/draggable.js";
import {History} from "/static/js/history.js";
import {clip} from "/static/js/math.js";
import {COEFFICIENTS_DEPTH, zero_spline, BPoly} from "/static/js/spline.js";
import {clear_array, insert_after, add_option, remove_all_children, emit_event} from "/static/js/utils.js";
import {CurverBase} from "/static/components/editor/curver.js";
import {Line} from "/static/components/editor/line.js";
import { CurveList } from "/static/components/editor/curve_list.js";
import {MotorSelector, dont_display_select_when_no_options, NOTHING_SELECTED} from "/static/components/editor/motor_selector.js";
import {CurveDrawer} from "/static/components/editor/drawer.js";
import {PAUSED, PLAYING, RECORDING, Transport} from "/static/components/editor/transport.js";
import { Widget, append_template_to } from "/static/js/widget.js";



/** @const {number} - Magnification factor for one single click on the zoom buttons */
const ZOOM_FACTOR_PER_STEP = 1.5;

/** @const {string} - Folded motion / spline list HTML attribute */
const FOLDED = "folded";

/** @const {Number} - Default spline knot shift offset amount...  */
const DEFAULT_KNOT_SHIFT = 0.5;

/** @const {Number} - HTTP OK.*/
const OK = 200;


/**
 * Zoom / scale bounding box.
 *
 * @param {Bbox} bbox Bounding box to scale.
 * @param {Number} factor Zoom factor.
 */
function zoom_bbox(bbox, factor) {
    const zoomed = bbox.copy();
    const mid = .5 * (bbox.left + bbox.right);
    zoomed.left = 1 / factor * (bbox.left - mid) + mid;
    zoomed.right = 1 / factor * (bbox.right - mid) + mid;
    return zoomed;
}


/**
 * Zoom / scale bounding box in place.
 *
 * @param {Bbox} bbox Bounding box to scale.
 * @param {Number} factor Zoom factor.
 */
function zoom_bbox_in_place(bbox, factor) {
    const mid = .5 * (bbox.left + bbox.right);
    bbox.left = 1 / factor * (bbox.left - mid) + mid;
    bbox.right = 1 / factor * (bbox.right - mid) + mid;
}


/**
 * Scale spline by factor (scale coefficients).
 */
function scale_spline(spline, factor) {
    const shape = array_shape(spline.c);
    const scaledCoeffs = array_reshape(multiply_scalar(factor, spline.c.flat(COEFFICIENTS_DEPTH)), shape);
    return new BPoly(scaledCoeffs, spline.x);
}


/**
 * Stretch spline by factor (stretch knots).
 */
function stretch_spline(spline, factor) {
    const stretchedKnots = multiply_scalar(factor, spline.x);
    return new BPoly(spline.c, stretchedKnots);
}


/**
 * Shift all control points of spline by some offset.
 */
function shift_spline(spline, offset) {
    const start = spline.x[0];
    offset = Math.max(offset, -start);
    const shiftedKnots = spline.x.map(pos => {
        return pos + offset;
    });

    return new BPoly(spline.c, shiftedKnots);
}


/**
 * Purge outdated keys from map.
 */
function purge_map(map, keys) {
    keys = Array.from(keys)
    for (const k of map.keys()) {
        if (!keys.includes(k)) {
            map.delete(k)
        }
    }
}


const EDITOR_TEMPLATE = `
<style>
    :host {
        min-height: 50vh;
        display: flex;
        flex-flow: column;
    }
    .container {
        display: flex;
        flex-flow: row;
        align-items: strech;
        flex-grow: 1;
    }
    being-curve-list {
        flex-grow: 0;
    }

    being-curve-drawer {
        flex-grow: 1;
        border: none;
    }

    [folded] {
        display: none;
    }
</style>
<div class="container">
    <being-curve-list id="curve-list"></being-curve-list>
    <being-curve-drawer id="plotter"></being-curve-drawer>
</div>
`;


/**
 * Motion editor.
 *
 * Shadow root with canvas and SVG overlay.
 */
export class Editor extends Widget {
    constructor() {
        super();
        //this._append_link("static/components/editor/motion_editor.css");
        this.append_template(EDITOR_TEMPLATE)

        this.api = new Api();
        this.histories = new Map();  // Curve name -> History instance
        this.list = this.shadowRoot.querySelector("being-curve-list");
        this.drawer = this.shadowRoot.querySelector("being-curve-drawer");
        this.transport = new Transport(this.drawer);
        this.interval = null;
        this.notificationCenter = null;

        this.motionPlayers = [];
        this.actualValueIndices = [];
        this.outputIndices = [];
        this.selectedMotionPlayer = undefined;
        this.recordedTrajectory = [];

        // The following undefined attributes will be created during
        // setup_toolbar_elements()
        this.motionPlayerSelect = undefined;
        this.channelSelect = undefined;
        this.addChannelBtn = undefined;
        this.removeChannelBtn = undefined;
        this.setup_toolbar_elements();

        this.update_ui();
    }

    get history() {
        const selected = this.list.selected;
        if (!selected) {
            throw "No curve selected yet";
        }

        if (!this.histories.has(selected)) {
            throw "No history for curve " + selected;
        }

        return this.histories.get(selected);
    }

    // Setup and data accessors

    async connectedCallback() {
        const config = await this.api.get_config();
        this.interval = config["Web"]["INTERVAL"];

        // Motion player selection
        this.motionPlayers = await this.api.get_motion_player_infos();
        this.setup_motion_player_select();
        this.motionPlayerSelect.addEventListener("change", () => {
            if (this.list.selected) {
                this.list.associate_motion_player(this.list.selected, this.selectedMotionPlayer);
            }
            this.assign_channel_names();
        })
        this.init_plotting_lines();

        this.toggle_limits();  // Enable by default. Can only happens once we have selected a motion player!

        // Channel select
        this.setup_channel_select();

        // Curve list
        this.setup_curve_list();

        // Drawer stuff
        // SVG event listeners
        this.drawer.svg.addEventListener("click", evt => {
            this.drawer.clear_lines();
            const pt = this.drawer.mouse_coordinates(evt);
            this.transport.position = pt[0];
            this.transport.draw_cursor();
            if (this.transport.playing) {
                this.play_current_motions();
            }
        });
        // TODO: Move to CurveDrawer
        this.drawer.svg.addEventListener("dblclick", evt => {
            // TODO: How to prevent accidental text selection?
            //evt.stopPropagation()
            //evt.preventDefault();
            this.stop_motion_playback();
            this.insert_new_knot(evt);
        });

        this.drawer.addEventListener("curvechanging", evt => {
            this.curve_changing(evt.detail.position);
        });
        this.drawer.addEventListener("curvechanged", evt => {
            this.curve_changed(evt.detail.newCurve);
        });

        // TODO: Can / should this go to the constructor?
        this.setup_keyboard_shortcuts();
    }

    /**
     * Populate toolbar with buttons and motion planner / motor selections.
     * Wire up event listeners.
     */
    setup_toolbar_elements() {
        // Toggle motion list
        this.listBtn = this.add_button_to_toolbar("list", "Toggle spline list");
        this.listBtn.addEventListener("click", () => {
            this.list.toggleAttribute(FOLDED);
            this.update_ui();
            this.drawer.resize();
        });
        this.listBtn.style.display = "none";
        //this.add_space_to_toolbar();


        // Editing history buttons
        this.newBtn = this.add_button_to_toolbar("add_box", "Create new spline");
        this.newBtn.addEventListener("click", () => {
            this.create_new_curve();
        });
        this.newBtn.style.display = "none";
        this.undoBtn = this.add_button_to_toolbar("undo", "Undo last action");
        this.undoBtn.addEventListener("click", () => {
            this.undo();
        });
        this.redoBtn = this.add_button_to_toolbar("redo", "Redo last action");
        this.redoBtn.addEventListener("click", () => {
            this.redo();
        });
        this.add_space_to_toolbar();


        // Zoom buttons
        this.add_button_to_toolbar("zoom_in", "Zoom in").addEventListener("click", () => {
            const zoomedIn = zoom_bbox(this.drawer.viewport, ZOOM_FACTOR_PER_STEP);
            this.drawer.change_viewport(zoomedIn);
        });
        this.add_button_to_toolbar("zoom_out", "Zoom out").addEventListener("click", () => {
            const zoomedOut = zoom_bbox(this.drawer.viewport, 1 / ZOOM_FACTOR_PER_STEP);
            this.drawer.change_viewport(zoomedOut);
        });
        this.add_button_to_toolbar("zoom_out_map", "Reset zoom").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            const current = this.history.retrieve();
            const bbox = current.bbox();
            this.drawer.change_viewport(bbox);
        });
        this.add_space_to_toolbar();


        // Motion player selection
        this.motionPlayerSelect = this.add_select_to_toolbar();


        // Transport buttons
        this.playPauseBtn = this.add_button_to_toolbar("play_arrow", "Play / pause motion playback");
        this.stopBtn = this.add_button_to_toolbar("stop", "Stop spline playback");
        this.stopBtn.style.display = "none";
        this.recBtn = this.add_button_to_toolbar("fiber_manual_record", "Record motion");
        this.recBtn.classList.add("record");
        this.loopBtn = this.add_button_to_toolbar("loop", "Loop spline motion");
        this.playPauseBtn.addEventListener("click", async () => {
            this.toggle_motion_playback();
        });
        this.recBtn.addEventListener("click", () => {
            this.toggle_recording();
        });
        this.stopBtn.addEventListener("click", async () => {
            this.stop_motion_playback();
            this.transport.stop();  // Not the same as pause() which gets triggered in stop_spline_playback()!
        });
        this.loopBtn.addEventListener("click", () => {
            this.transport.toggle_looping();
            this.update_ui();
        });
        this.add_space_to_toolbar();


        // Motor channel selection
        this.channelSelect = this.add_select_to_toolbar();
        this.removeChannelBtn = this.add_button_to_toolbar("remove_circle", "Remove current curve");
        this.addChannelBtn = this.add_button_to_toolbar("add_circle", "Add new curve");
        this.add_space_to_toolbar()


        // Tool adjustments
        this.snapBtn = this.add_button_to_toolbar("grid_3x3", "Snap to grid");  // TODO: Or vertical_align_center?
        this.snapBtn.addEventListener("click", () => this.toggle_snap_to_grid());

        this.c1Btn = this.add_button_to_toolbar("timeline", "Break continous knot transitions");
        this.c1Btn.addEventListener("click", () => this.toggle_c1());

        this.limitBtn = this.add_button_to_toolbar("fence", "Limit motion to selected motor");
        this.limitBtn.addEventListener("click", () => this.toggle_limits());

        this.livePreviewBtn = this.add_button_to_toolbar("precision_manufacturing", "Toggle live preview of knot position on the motor");
        switch_button_on(this.livePreviewBtn);
        this.livePreviewBtn.addEventListener("click", () => {
            toggle_button(this.livePreviewBtn);
        });
        this.add_space_to_toolbar();


        // Spline manipulation
        this.add_button_to_toolbar("compress", "Scale down position (1/2x)").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            this.curve_changing();
            const newSpline = scale_spline(this.history.retrieve(), 0.5);
            this.curve_changed(newSpline);

        });
        this.add_button_to_toolbar("expand", "Scale up position (2x)").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            this.curve_changing();
            const newSpline = scale_spline(this.history.retrieve(), 2.0);
            this.curve_changed(newSpline);
        });
        this.add_button_to_toolbar("directions_run", "Speed up motion").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            this.curve_changing();
            const newSpline = stretch_spline(this.history.retrieve(), 0.5);
            this.curve_changed(newSpline);
        });
        this.add_button_to_toolbar("hiking", "Slow down motion").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            this.curve_changing();
            const newSpline = stretch_spline(this.history.retrieve(), 2.0);
            this.curve_changed(newSpline);
        });
        this.add_button_to_toolbar("first_page", "Move to the left. Remove delay at the beginning.").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            this.curve_changing();
            const newSpline = shift_spline(this.history.retrieve(), -Infinity);
            this.curve_changed(newSpline);
        });
        this.add_button_to_toolbar("chevron_left", "Shift knots to the left").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            this.curve_changing();
            const newSpline = shift_spline(this.history.retrieve(), -DEFAULT_KNOT_SHIFT);
            this.curve_changed(newSpline);
        });
        this.add_button_to_toolbar("chevron_right", "Shift knots to the right").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            this.curve_changing();
            const newSpline = shift_spline(this.history.retrieve(), DEFAULT_KNOT_SHIFT);
            this.curve_changed(newSpline);
        });
        this.add_button_to_toolbar("clear", "Reset current motion").addEventListener("click", () => {
            if (!this.history.length) {
                return;
            }

            this.curve_changing();
            if (this.has_motion_players()) {
                const ndim = this.selectedMotionPlayer.ndim;
                const curve = zero_spline(ndim);
                this.curve_changed(curve);
            }
        });

        this.add_space_to_toolbar()

        // Upload button. It is murky...
        const form = document.createElement("form");
        form.setAttribute("action", "api/upload-curves");
        form.setAttribute("method", "post");
        form.setAttribute("enctype", "multipart/form-data");
        //form.setAttribute("accept-charset", "utf-8");
        const templateStr = `
        <label for="file-upload" class="mdl-button mdl-js-button mdl-button--icon mdl-button--file">
            <i id="file-upload-button" class="material-icons"
                title="Upload some motions. Multiple .json or .zip files."
            >file_upload</i>
            <input
                type="file"
                id="file-upload"
                name="files"
                accept=".json, .zip"
                multiple="multiple"
                onchange="//this.form.submit();"
                hidden
            ></input>
        </label>
        `;
        append_template_to(templateStr, form);
        const fileinput = form.querySelector("input[type='file']")
        fileinput.addEventListener("change", async evt => {
            console.log('this change:');
            //evt.target.form.submit();
            form.dispatchEvent(new Event('submit'));
        });
        form.addEventListener("submit", async evt => {
            console.log("this submit");
            evt.preventDefault();
            const resp = await fetch(form.action, {
                method: form.method,
                body: new FormData(form),
            });
            console.log("resp:", resp);
            const notifications = await resp.json();
            /*
            for (let i in notis) {
                const dct = notis[i];
                console.log("dct:", dct);
                this.notificationCenter.notify(dct.message, dct.type)
                await sleep(0.5);
            }
            */
            if (this.notificationCenter !== null) {
                notifications.forEach(async dct => {
                    this.notificationCenter.notify(dct.message, dct.type, 3.5);
                });
            }
        });

        this.toolbar.appendChild(form);
        //this.add_button_to_toolbar("file_upload", "Upload some motions");
        const btn = this.add_button_to_toolbar("file_download", "Download all motions as a Zip archive");
        btn.addEventListener("click", async evt => {
            // https://stackoverflow.com/questions/3749231/download-file-using-javascript-jquery
            const resp = await this.api.download_all_curves_as_zip();
            const blob = await resp.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'being-content.zip' // the filename you want
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        });

    }

    /**
     * Register key event listeners for shortcuts.
     */
    setup_keyboard_shortcuts() {
        addEventListener("keydown", evt => {
            if (document.activeElement !== document.body) {
                return;
            }

            const ctrlOrMeta = evt.ctrlKey || evt.metaKey;
            if (ctrlOrMeta && !evt.shiftKey) {
                switch (evt.key) {
                    case "u":
                        this.toggle_snap_to_grid();
                        break;
                    case "z":
                        this.undo();
                        break;
                }
            } else if (ctrlOrMeta && evt.shiftKey) {
                switch (evt.key) {
                    case "z":
                        this.redo();
                        break;
                }
            } else {
                switch (evt.key) {
                    case " ":
                        evt.preventDefault();
                        this.toggle_motion_playback();
                        break;
                    case "r":
                        this.toggle_recording();
                        break;
                    case "l":
                        this.transport.toggle_looping();
                        break;
                    case "c":
                        toggle_button(this.c1Btn);
                        break;
                }
            }

            this.update_ui();
        });
    }

    /**
     * Initialize enough plotting lines for each motion player and its motors.
     * For persistent coloring across sessions.
     */
    init_plotting_lines() {
        this.actualValueIndices.forEach(indices => {
            indices.forEach(idx => {
                this.drawer.init_new_line(idx);
            })
        })
    }

    /**
     * Populate motion player select and determine currently selected motion
     * player.
     */
    setup_motion_player_select() {
        this.actualValueIndices = [];
        remove_all_children(this.motionPlayerSelect);
        this.motionPlayers.forEach(mp => {
            add_option(this.motionPlayerSelect, mp.name);

            // Lookup indices of actual value outputs for each motion player
            // and its motors
            const idx = [];
            mp.motors.forEach(async motor => {
                const outs = await this.api.get_index_of_value_outputs(motor.id);
                idx.push(...outs);
            });
            this.actualValueIndices.push(idx);
        });
        this.motionPlayerSelect.addEventListener("change", evt => {
            this.update_motion_player_selection();
        });
        dont_display_select_when_no_options(this.motionPlayerSelect);
        if (this.has_motion_players()) {
            this.update_motion_player_selection();
        }
    }

    /**
     * Update currently selected motion player, output indices.
     */
    update_motion_player_selection() {
        const idx = this.motionPlayerSelect.selectedIndex;
        this.selectedMotionPlayer = this.motionPlayers[idx];
        this.outputIndices = this.actualValueIndices[idx];
    }

    /**
     * Do we have at least one motion player?
     */
    has_motion_players() {
        return this.motionPlayers.length > 0;
    }

    /**
     * Select (another) motion player.
     */
    select_motion_player(motionPlayer) {
        const idx = this.motionPlayers.findIndex(mp => mp.id === motionPlayer.id);
        this.motionPlayerSelect.selectedIndex = idx;
        this.update_motion_player_selection();
    }

    /**
     * Setup curve channel select.
     */
    setup_channel_select() {
        this.channelSelect.addEventListener("change", () => {
            this.draw_current_curves();
        });
        this.addChannelBtn.addEventListener("click", () => {
            this.add_channel();
        });
        this.removeChannelBtn.addEventListener("click", () => {
            this.remove_channel();
        });
        this.assign_channel_names();
    }

    /**
     * Currently selected channel number.
     *
     * @returns Channel number.
     */
    selected_channel() {
        return this.channelSelect.selectedIndex;
    }

    /**
     * Current number of curves.
     */
    number_of_channels() {
        // TODO: Return current number of curves. Either from selected curve,
        // motion player max channels, number of child elements in
        // channelSelect?
        return this.channelSelect.childElementCount;
    }

    /**
     * Add a new curve to the current motion / curve set.
     */
    add_channel() {
        // TODO: Makeme
        const idx = this.channelSelect.selectedIndex;
        add_option(this.channelSelect, "Placeholder", idx);
        this.update_ui();
    }

    /**
     * Remove the currently selected channel from curve.
     */
    remove_channel() {
        // TODO: Makeme
        const idx = this.channelSelect.selectedIndex;
        if (idx === NOTHING_SELECTED) {
            return;
        }
        const opt = this.channelSelect.children[idx];
        this.channelSelect.removeChild(opt);
        this.update_ui();
    }

    /**
     * Assign channels names. Take motor names if possible. Excess channels
     * will be labeled with "Curve X"...
     */
    assign_channel_names() {
        const nChannels = this.channelSelect.childElementCount;
        let mid = nChannels;
        let mp = undefined;
        if (this.has_motion_players()) {
            mp = this.selectedMotionPlayer;
            mid = Math.min(mid, mp.ndim);
        }

        for (let i=0; i<mid; i++) {
            const opt = this.channelSelect.children[i];
            opt.innerHTML = mp.motors[i].name;
        }

        for (let i=mid; i<nChannels; i++) {
            const opt = this.channelSelect.children[i];
            opt.innerHTML = `Curve ${i + 1}`;
        }
    }

    /**
     * TODO
     */
    set_number_of_channels_to(nChannels) {
        while (this.number_of_channels() > nChannels) {
            this.remove_channel();
        }
        while (this.number_of_channels() < nChannels ) {
            this.add_channel();
        }
    }

    /**
     * Setup curve list and wire it up.
     */
    setup_curve_list() {
        this.list.newBtn.addEventListener("click", evt => {
            this.create_new_curve();
        });
        this.list.deleteBtn.addEventListener("click", evt => {
            this.delete_current_curve();
        });
        this.list.duplicateBtn.addEventListener("click", evt => {
            this.duplicate_current_curve();
        });
        this.list.addEventListener("selectedchanged", evt => {
            const selected = this.list.selected;
            if (selected === undefined) {
                throw "Nothing selected!";
            }

            // Update motion player select
            const mp = this.list.associated_motion_player(selected);
            if (mp !== undefined) {
                this.select_motion_player(mp);
            }

            // Update channel select
            const selectedCurve = this.list.selected_curve();
            this.set_number_of_channels_to(selectedCurve.ndim);

            this.draw_curve(selected, selectedCurve);
        });
        this.list.addEventListener("armedchanged", evt => {
            this.draw_current_curves();
        });

        if (this.list.selected) {
            this.list.emit_custom_event("selectedchanged");
        }
    }

    // Actions

    /**
     * Toggle snapping to grid inside drawer.
     */
    toggle_snap_to_grid() {
        const opposite = !this.drawer.snapping_to_grid;
        this.drawer.snapping_to_grid = opposite;
        switch_button_to(this.snapBtn, opposite);
    }

    /**
     * Toggle c1 continuity in drawer.
     */
    toggle_c1() {
        const opposite = !this.drawer.c1;
        this.drawer.c1 = opposite;
        switch_button_to(this.c1Btn, !opposite);
    }

    /**
     * Activate drawing limits from selected motion player.
     */
    assure_limits() {
        if (this.has_motion_players()) {
            const limited = new BBox([0, 0], [Infinity, 0.001]);
            this.selectedMotionPlayer.motors.forEach(motor => {
                limited.expand_by_point([Infinity, motor.length]);
            });
            this.drawer.limits = limited;
        } else {
            this.no_limits();
        }
    }

    /**
     * Deactivate drawing limits.
     */
    no_limits() {
        const noLimits = new BBox([0, -Infinity], [Infinity, Infinity]);
        this.drawer.limits = noLimits;
    }

    /**
     * Toggle limiting curve control points for the given motion player / motors.
     * TODO: This has to be changed if the motion player changes!
     */
    toggle_limits() {
        if (!this.has_motion_players()) {
            this.no_limits();
            switch_button_to(this.limitBtn, false);
        }

        const opposite = !is_checked(this.limitBtn);
        if (opposite) {
            this.assure_limits();
        } else {
            this.no_limits()
        };

        switch_button_to(this.limitBtn, opposite);
    }

    /**
     * Undo latest editing step.
     */
    async undo() {
        if (this.history.undoable) {
            this.history.undo();
            this.stop_motion_playback();
            this.draw_current_curves();
            await this.save_current_curve();
        }
    }

    /**
     * Redo latest editing step.
     */
    async redo() {
        if (this.history.redoable) {
            this.history.redo();
            this.stop_motion_playback();
            this.draw_current_curves();
            await this.save_current_curve();
        }
    }

    /**
     * Create a new curve.
     */
    async create_new_curve() {
        if (this.confirm_unsaved_changes()) {
            const freename = await this.api.find_free_name();
            //const nCurves = this.selectedMotionPlayer.ndim if this.has_motion_players()
            const nCurves  = this.has_motion_players() ?  this.selectedMotionPlayer.ndim : 1;
            const newCurve = zero_spline(nCurves);
            const resp = await this.api.create_curve(freename, newCurve)
            if (resp.status !== OK) {
                console.log("Something went wrong creating new curve on server");
                console.log("resp:", resp);
            }
        }
    }

    /**
     * Save current working copy of selected curve.
     */
    async save_current_curve() {
        if (!this.history.length) {
            return console.log("Nothing to save!");
        }

        const name = this.list.selected;

        if (name === undefined) {
            return console.log("No curve selected!");
        }

        const curve = this.history.retrieve();
        await this.api.update_curve(name, curve);
    }

    /**
     * Delete current curve.
     */
    async delete_current_curve() {
        const selected = this.list.selected;
        if (!selected) {
            return console.log("No curve selected!");
        }

        if (confirm(`Are you sure you want to delte ${selected}?`)) {
            const resp = await this.api.delete_curve(selected);
            if (resp.status !== OK) {
                console.log(`Something went wrong deleting curve ${selected} new curve on server!`);
                console.log("resp:", resp);
            }
        }
    }

    /**
     * Duplicate current curve.
     */
    async duplicate_current_curve() {
        const selected = this.list.selected;
        if (!selected) {
            return console.log("No curve selected!");
        }

        if (selected) {
            const duplicateName = await this.api.find_free_name(`${selected} Copy`);
            const curve = this.list.curves.get(selected);
            const resp = await this.api.create_curve(duplicateName, curve)
            if (resp.status !== OK) {
                console.log("Something went wrong duplicating curve on server");
                console.log("resp:", resp);
            }
        }
    }

    /**
     * Start playback of current spline in back end.
     */
    async play_current_motions() {
        if (!this.has_motion_players()) {
            return;
        }

        const spline = this.history.retrieve();
        const motionPlayer = this.selectedMotionPlayer;
        const loop = this.transport.looping;
        const offset = this.transport.position;
        const startTime = await this.api.play_spline(spline, motionPlayer.id, loop, offset);
        this.transport.startTime = startTime + INTERVAL;
        this.transport.play();
        this.update_ui();
    }

    /**
     * Stop all spline playback in back end.
     */
    async stop_motion_playback() {
        if (!this.transport.paused) {
            await this.api.stop_spline_playback();
            this.transport.pause();
            this.update_ui();
        }
    }

    /**
     * Toggle spline playback of current spline.
     */
    toggle_motion_playback() {
        if (this.transport.playing) {
            this.stop_motion_playback();
        } else {
            this.play_current_motions();
        }
    }

    /**
     * Start recording trajectory. Disables motors in back end.
     */
    async start_recording() {
        this.transport.record();
        this.drawer.lines.forEach(line => {
            line.data.clear();
            line.data.maxlen = Infinity;
        });
        this.drawer.clear();
        await this.api.disable_motors();
        this.update_ui();
    }

    /**
     * Stop trajectory recording, re-enable motors and fit smoothing spline
     * through trajectory via back end.
     */
    async stop_recording() {
        this.transport.stop();
        await this.api.enable_motors();
        if (!this.recordedTrajectory.length) {
            return;
        }

        try {
            const spline = await this.api.fit_spline(this.recordedTrajectory);
            clear_array(this.recordedTrajectory);
            this.history.capture(spline);
            this.draw_current_spline();
        } catch(err) {
            console.log(err);
        }

        this.update_ui();
    }

    /**
     * Toggle trajectory recording.
     */
    toggle_recording() {
        if (this.transport.recording) {
            this.stop_recording();
        } else {
            this.start_recording();
        }
    }

    /**
     * Insert new knot into current spline.
     */
    insert_new_knot(evt) {
        if (this.history.length === 0) {
            return;
        }

        const pos = this.drawer.mouse_coordinates(evt);
        this.curve_changing(pos);

        const currentSpline = this.history.retrieve();
        const newSpline = currentSpline.copy();
        newSpline.insert_knot(pos);

        // TODO: Do some coefficients cleanup. Wrap around and maybe take the
        // direction of the previous knots as the new default coefficients...
        this.curve_changed(newSpline);
    }

    // Actions spline drawing


    draw_curve(name, curve) {
        if (!this.histories.has(name)) {
            const hist = new History();
            hist.capture(curve)
            this.histories.set(name, hist);
        }

        this.drawer.change_viewport(curve.bbox())
        this.draw_current_curves();
    }


    draw_current_curves() {
        const current = this.history.retrieve();
        if (!current) {
            return console.log("No current curve!", current);
        }

        const duration = current.end;
        this.transport.duration = duration;
        this.drawer.maxlen = 0.9 * duration / this.interval;

        this.drawer.clear();
        //this.drawer.expand_viewport_vertically(current.min, current.max);
        this.drawer.expand_viewport_by_bbox(current.bbox());
        this.list.background_curves().forEach(curve => {
            this.drawer.draw_background_curve(curve);
        });

        const channel = this.selected_channel();
        this.drawer.draw_foreground_curve(current, channel);
        this.drawer._draw_curves();
        this.update_ui();
    }

    /**
     * Notify spline editor that the spline working copy is going to change.
     * Also supply a optional [x, y] position value for the live preview
     * feature (if enabled).
     */
    curve_changing(position = null) {
        this.stop_motion_playback();
        this.drawer.clear_lines();
        if (position !== null) {
            const [x, y] = position;
            this.transport.position = x;
            this.transport.draw_cursor();

            if (!this.has_motion_players()) {
                return;
            }

            if (is_checked(this.livePreviewBtn)) {
                return;  // TODO
                const motionPlayer = this.motorSelector.selected_motion_player();
                const channel = this.motorSelector.selected_motor_channel();
                this.api.live_preview(y, motionPlayer.id, channel);
            }
        }
    }

    /**
     * Notify spline editor that with the new current state of the spline.
     */
    async curve_changed(workingCopy) {
        workingCopy.restrict_to_bbox(this.drawer.limits);
        this.history.capture(workingCopy);
        this.draw_current_curves();
        await this.save_current_curve();
    }

    // Misc

    /**
     * Check if there are unsaved changes and get confirmation of the user to proceed.
     */
    confirm_unsaved_changes() {
        if (this.history.savable) {
            return confirm("Are you sure you want to leave without saving?");
        }

        return true;
    }

    /**
     * Update UI elements. Mostly buttons at this time. Disabled state of undo
     * / redo buttons according to history.
     */
    update_ui() {
        this.removeChannelBtn.disabled = (this.number_of_channels() === 0);
        this.assign_channel_names();

        switch_button_to(this.listBtn, !this.list.hasAttribute(FOLDED));

        if (this.histories.has(this.list.selected)) {
            this.undoBtn.disabled = !this.history.undoable;
            this.redoBtn.disabled = !this.history.redoable;
        } else {
            this.undoBtn.disabled = true;
            this.redoBtn.disabled = true;
        }

        switch (this.transport.state) {
            case PAUSED:
                this.playPauseBtn.innerHTML = "play_arrow";
                if (this.has_motion_players()) {
                    enable_button(this.playPauseBtn);
                } else {
                    disable_button(this.playPauseBtn);
                }

                switch_button_off(this.playPauseBtn);

                this.recBtn.innerHTML = "fiber_manual_record";
                enable_button(this.recBtn);
                switch_button_off(this.recBtn);

                enable_button(this.stopBtn);

                this.motionPlayerSelect.disabled = false;
                break;
            case PLAYING:
                this.playPauseBtn.innerHTML = "pause";
                enable_button(this.playPauseBtn);
                switch_button_on(this.playPauseBtn);

                this.recBtn.innerHTML = "fiber_manual_record";
                disable_button(this.recBtn);
                switch_button_off(this.recBtn);

                enable_button(this.stopBtn);

                this.motionPlayerSelect.disabled = true;
                break;
            case RECORDING:
                this.playPauseBtn.innerHTML = "play_arrow";
                disable_button(this.playPauseBtn);
                switch_button_off(this.playPauseBtn);

                this.recBtn.innerHTML = "pause";
                enable_button(this.recBtn);
                switch_button_on(this.recBtn);

                disable_button(this.stopBtn);

                this.motionPlayerSelect.disabled = true;
                break;
            default:
                throw "Ooops, something went wrong with the transport FSM!";
        }

        this.limitBtn.disabled = !this.has_motion_players();
        switch_button_to(this.loopBtn, this.transport.looping);
        switch_button_to(this.snapBtn, this.drawer.snapping_to_grid);
        switch_button_to(this.c1Btn, !this.drawer.c1);
    }

    // Public

    /**
     * Register notification center.
     */
    set_notification_center(notificationCenter) {
        this.notificationCenter = notificationCenter;
    }

    /**
     * Process new data message from back-end.
     */
    new_data(msg) {
        const t = this.transport.move(msg.timestamp);
        if (this.transport.playing && t > this.transport.duration) {
            this.transport.stop();
            this.update_ui();
        }

        if (this.transport.paused) {
            this.drawer.forget();
        } else {
            this.outputIndices.forEach(idx => {
                const actualValue = msg.values[idx];
                this.drawer.plot_value(t, actualValue, idx);
            });
        }
        this.drawer.draw();

        if (this.transport.recording) {
            const vals = [];
            this.outputIndices.forEach(idx => {
                vals.push(msg.values[idx]);
            });
            this.recordedTrajectory.push([t].concat(vals));
        }
    }

    /**
     * Process new behavior message from back-end.
     */
    new_behavior_message(behavior) {
        return
        if (behavior.active) {
            this.transport.stop();
            this.update_ui();
        }
    }

    /**
     * Process new motions message (forward to curvelist).
     */
    new_motions_message(msg) {
        const names = []
        msg.curves.forEach(curvename => {
            names.push(curvename[0]);
        })
        purge_map(this.histories, names);
        this.list.new_motions_message(msg);
    }
}

customElements.define("being-editor", Editor);
