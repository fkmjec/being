"""Some universal CANopen (CiA 302, CiA 402) register definitions. EDS
independent.
"""
import enum


# Mandatory CiA 302
DEVICE_TYPE = 0x1000
#ERROR_REGISTER = 0x1001
#IDENTITY_OBJECT = 0x1018
#VENDOR_ID = 0x1018, 1
#PRODUCT_CODE = 0x1018, 2
#REVISION_NUMBER = 0x1018, 3
#SERIAL_NUMBER = 0x1018, 4

# Non-mandatory fields
#MANUFACTURER_DEVICE_NAME = 0x1008
STORE_EDS = 0x1021


MOTOR_DATA = 0x2350
ENCODER_DATA = 0x2351

# CiA 402
CONTROLWORD = 0x6040
STATUSWORD = 0x6041
MODES_OF_OPERATION = 0x6060
MODES_OF_OPERATION_DISPLAY = 0x6061
POSITION_DEMAND_VALUE = 0x6062
POSITION_ACTUAL_INTERNAL_VALUE = 0x6063
POSITION_ACTUAL_VALUE = 0x6064
POSITION_WINDOW = 0x6067
POSITION_WINDOW_TIME = 0x6068
VELOCITY_DEMAND_VALUE = 0x606B
VELOCITY_ACTUAL_VALUE = 0x606C
VELOCITY_WINDOW = 0x606D
VELOCITY_WINDOW_TIME = 0x606E
VELOCITY_THRESHOLD = 0x606F
VELOCITY_THRESHOLD_TIME = 0x6070
CURRENT_ACTUAL_VALUE = 0x6078
TARGET_POSITION = 0x607A
POSITION_RANGE_LIMIT = 0x607B
HOMING_OFFSET = 0x607C
SOFTWARE_POSITION_LIMIT = 0x607D
POLARITY = 0x607E
MAX_PROFILE_VELOCITY = 0x607F
PROFILE_VELOCITY = 0x6081
PROFILE_ACCELERATION = 0x6083
PROFILE_DECELERATION = 0x6084
QUICK_STOP_DECELERATION = 0x6085
POSITION_ENCODER_RESOLUTION = 0x608F
GEAR_RATIO = 0x6091
FEED_CONSTANT = 0x6092
POSITION_FACTOR = 0x6093
HOMING_METHOD = 0x6098
HOMING_SPEED = 0x6099
HOMING_ACCELERATION = 0x609A
CONTROL_EFFORT = 0x60FA
DIGITAL_INPUTS = 0x60FD
TARGET_VELOCITY = 0x60FF
SUPPORTED_DRIVE_MODES = 0x6502


class FunctionCode(enum.IntEnum):

    """Canopen function operation codes.
    TODO: Is 'FunctionCode' the right name for this?
    """

    NMT = (0b0000 << 7)  # 0x0 + node id
    SYNC = (0b0001 << 7)  # 0x80 + node id
    EMERGENCY = (0b0001 << 7)  # 0x80 + node id
    PDO1tx = (0b0011 << 7)  # 0x180 + node id
    PDO1rx = (0b0100 << 7)  # 0x200 + node id
    PDO2tx = (0b0101 << 7)  # 0x280 + node id
    PDO2rx = (0b0110 << 7)  # 0x300 + node id
    PDO3tx = (0b0111 << 7)  # 0x380 + node id
    PDO3rx = (0b1000 << 7)  # 0x400 + node id
    PDO4tx = (0b1001 << 7)  # 0x480 + node id
    PDO4rx = (0b1010 << 7)  # 0x500 + node id
    SDOtx = (0b1011 << 7)  # 0x580 + node id
    SDOrx = (0b1100 << 7)  # 0x600 + node id
    NMTErrorControl = (0b1110 << 7)  # 0x700 + node id


class TransmissionType(enum.IntEnum):

    """PDO transmission type."""

    SYNCHRONOUS_ACYCLIC = 0
    SYNCHRONOUS_CYCLIC = 1

    ...

    ASYNCHRONOUS = 255
