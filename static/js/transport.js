"use strict";
import { create_element, setattr } from "/static/js/svg.js";
import { last_element } from "/static/js/utils.js";

/**
 * Transport / playback cursor container. Current playing position, duration,
 * looping, playing, cursor drawing.
 */
export class Transport {
    constructor(editor) {
        this.editor = editor;
        this.position = 0;
        this.playing = false;
        this.looping = false;
        this.recording = false;
        this.startTime = 0;
        this.duration = 1;
        this.init_cursor();
    }

    /**
     * Toggle looping.
     */
    toggle_looping() {
        this.looping = !this.looping;
        this.editor.update_ui();
    }

    /**
     * Initialize cursor SVG line.
     */
    init_cursor() {
        const line = create_element("line");
        setattr(line, "stroke-width", 2);
        setattr(line, "stroke", "gray");
        this.editor.transportGroup.appendChild(line);
        this.cursor = line;
    }

    /**
     * Start playback in transport.
     */
    play() {
        this.playing = true;
        this.editor.update_ui();
    }

    /**
     * Pause playback in transport.
     */
    pause() {
        this.playing = false;
        this.editor.update_ui();
    }

    stop() {
        this.pause();
        this.position = 0;
        this.draw_cursor();
    }

    /**
     * Draw SVG cursor line (update its attributes).
     */
    draw_cursor() {
        const [x, _] = this.editor.transform_point([this.position, 0]);
        setattr(this.cursor, "x1", x);
        setattr(this.cursor, "y1", 0);
        setattr(this.cursor, "x2", x);
        setattr(this.cursor, "y2", this.editor.height);
    }

    /**
     * Update transport position.
     */
    move(timestamp) {
        let pos = timestamp - this.startTime;

        const currentSpline = this.editor.history.retrieve();
        this.duration = last_element(currentSpline.x)

        if (this.looping) {
            pos %= this.duration;
        }

        if (this.playing && pos > this.duration) {
            this.stop();
        } else {
            this.position = pos;
        }

        this.draw_cursor();
        return pos;
    }
}
