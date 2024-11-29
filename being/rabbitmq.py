"""RabbitMQ blocks for receiving data from queues

Warning:
    Untested.
"""
import pika

from being.block import Block
from being.resources import register_resource
from being.serialization import EOT, FlyByDecoder, dumps


# def format_address(address: Address) -> str:
#     """Format socket address."""
#     host, port = address
#     if host == '':
#         host = '0.0.0.0'

#     return '%s:%d' % (host, port)


class RabbitMQIn(Block):

    """Datagram network in block. Receive being messages over UDP."""

    def __init__(self, address: str, port: int, queue_name: str, **kwargs):
        super().__init__(**kwargs)
        # TODO: start a RabbitMQ thread to handle the receiving and put the results in a queue
        # add one output

    def update(self):
        try:
            newData = self.sock.recv(BUFFER_SIZE).decode()
        except BlockingIOError:
            return

        for obj in self.decoder.decode_more(newData):
            self.output.send(obj)
