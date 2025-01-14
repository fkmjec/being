from being.block import Block
import json

class HeadPosition:
    def __init__(self, position: tuple, velocity: tuple, id: tuple, timestamp: int):
        self.position = position
        self.velocity = velocity
        self.id = id
        self.timestamp = timestamp

    def serialize(self):
        return json.dumps(vars(self))

    #TODO should this have an input in bytes or str?
    # currently it will be str and we will see how that goes
    @classmethod
    def deserialize(cls, serial_repr: str):
        loaded = json.loads(serial_repr)
        position = loaded["position"]
        velocity = loaded["velocity"]
        id = loaded["id"]
        timestamp = loaded["timestamp"]
        return HeadPosition(position, velocity, id, timestamp)


class HeadPositionParser(Block):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.add_message_input()
        self.add_message_output()
    
    def update(self):
        positions = []
        received = self.input.receive()

        for msg in received:
            for hp_ser in msg:
                positions.append(HeadPosition.deserialize(hp_ser))
        self.output.send(positions)
        

