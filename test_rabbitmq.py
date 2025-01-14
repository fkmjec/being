#!/usr/local/python3

import logging
import time

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
            first = msg
            # time.sleep(1)

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
    exchange = 'fanout'

    subscriber = RabbitMQInSubscriber(ampq_url, exchange)
    publisher = RabbitMQOutPublisher(ampq_url, exchange)
    parser = HeadPositionParser()

    input_printing = InputPrintingNode()
    output_generating = OutputGeneratingNode()
    # print the outputs of the node to test it
    output_generating | publisher
    subscriber | parser
    awake(output_generating, subscriber)
