#!/usr/local/python3

import logging

from being.awakening import awake
from being.rabbitmq import RabbitMQIn
from being.backends import CanBackend
from being.behavior import Behavior
from being.constants import FORWARD, BACKWARD, TAU
from being.logging import setup_logging, suppress_other_loggers
from being.logging import suppress_other_loggers
from being.motion_player import MotionPlayer
from being.motors import RotaryMotor
from being.resources import register_resource, manage_resources

if __name__ == "__main__":
    ampq_url = "amqp://guest:guest@localhost:5672/"
    # TODO: replace this with actual inputs
    exchange = 'message'
    queue = 'hello'
    routing_key = 'message.hello'

    node = RabbitMQIn(ampq_url, exchange, queue, routing_key)
    awake(node)
