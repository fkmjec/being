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
        self.output.send(f"{self.counter} test message")
        self.counter += 1
        # time.sleep(1)

if __name__ == "__main__":
    ampq_url = "amqp://guest:guest@localhost:5672/"
    # TODO: replace this with actual inputs
    exchange = 'fanout'

    subscriber = RabbitMQInSubscriber(ampq_url, exchange)
    publisher = RabbitMQOutPublisher(ampq_url, exchange)

    input_printing = InputPrintingNode()
    output_generating = OutputGeneratingNode()
    # print the outputs of the node to test it
    output_generating | publisher
    subscriber | input_printing
    awake(output_generating, subscriber)
