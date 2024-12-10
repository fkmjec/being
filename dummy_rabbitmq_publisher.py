import time
import pika
import logging

logging.basicConfig(level=logging.INFO)
connection = pika.BlockingConnection(
    pika.ConnectionParameters(host='localhost'))
channel = connection.channel()

channel.queue_declare(queue='hello')
counter = 0
while True:
    channel.basic_publish(exchange='message', routing_key='message.hello', body=f"{counter}: Hello World!")
    counter += 1
    print(" [x] Sent 'Hello World'")
    time.sleep(1)
connection.close()
