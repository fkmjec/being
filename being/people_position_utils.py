from being.block import Block
import json

class HeadPosition:
    def __init__(self, position: tuple, velocity: tuple, id: tuple, timestamp: float):
        # position in mm
        self.position = position
        # velocity in mm/s
        self.velocity = velocity
        # id is an identifier of a person kept as long as they are tracked
        self.id = id
        # timestamp is in seconds
        self.timestamp = timestamp

    def serialize(self):
        return json.dumps(vars(self))

    def to_dict(self):
        return vars(self)

    # TODO should this have an input in bytes or str?
    # currently it will be str and we will see how that goes
    @classmethod
    def deserialize(cls, serial_repr: str):
        loaded = json.loads(serial_repr)
        position = loaded["position"]
        velocity = loaded["velocity"]
        id = loaded["id"]
        timestamp = loaded["timestamp"]
        return HeadPosition(position, velocity, id, timestamp)


def deserialize_head_position_list(hps_ser: str):
    hps_list = json.loads(hps_ser)
    hps = []
    for hp_ser in hps_list:
        hps.append(HeadPosition.deserialize(hp_ser).to_dict())
    return hps


class HeadPositionParser(Block):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.add_message_input()
        self.add_message_output()
        self.positions = []

    def update(self):
        positions = []
        received = self.input.receive()

        for msg in received:
            for hp_ser in msg:
                positions += deserialize_head_position_list(hp_ser)
        if positions:
            self.positions = positions
        self.output.send(self.positions)
