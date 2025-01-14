#!/usr/local/python3

import logging
import time
import numpy as np

from being.awakening import awake
from being.rabbitmq import RabbitMQInSubscriber, RabbitMQOutPublisher
from being.backends import CanBackend
from being.behavior import Behavior
from being.constants import FORWARD, BACKWARD, TAU
from being.logging import setup_logging, suppress_other_loggers
from being.logging import suppress_other_loggers
from being.motion_player import MotionPlayer
from being.motors import RotaryMotor
from being.resources import register_resource, manage_resources
from being.connectables import MessageInput
from being.block import Block
from being.people_position_utils import HeadPositionParser, HeadPosition


class InputPrintingNode(Block):
    """Example block printing and passing on messages."""

    def __init__(self):
        super().__init__()
        self.add_message_input()

    def update(self):
        for msg in self.input.receive():
            print(msg)


class TimestampStatsGatheringNode(Block):
    def __init__(self):
        super().__init__()
        self.add_message_input()
        self.index = 0
        self.length = 50
        self.stats_len = self.length
        self.stats = np.ndarray(self.length)

    def update(self):
        for msg in self.input.receive():
            if msg:
                timestamp = msg[0]["timestamp"]
                diff = time.time() - timestamp
                self.stats[self.index] = diff
                self.index = (self.index + 1) % self.length

        if self.index == 0:
            print("latency min:", np.min(self.stats))
            print("latency max:", np.max(self.stats))
            print("latency mean:", np.mean(self.stats))


class OutputGeneratingNode(Block):
    def __init__(self):
        super().__init__()
        self.counter = 0
        self.add_message_output()

    def update(self):
        hp = HeadPosition((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 1, self.counter)
        self.output.send(hp.serialize())
        self.counter += 1
        # time.sleep(1)


if __name__ == "__main__":
    ampq_url = "amqp://guest:guest@localhost:5672/"
    exchange = "positions"

    subscriber = RabbitMQInSubscriber(ampq_url, exchange)
    parser = HeadPositionParser()

    input_printing = InputPrintingNode()
    output_generating = OutputGeneratingNode()
    stats = TimestampStatsGatheringNode()
    subscriber | parser | stats
    awake(output_generating, subscriber)
