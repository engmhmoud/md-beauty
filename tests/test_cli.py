import socket

import pytest

from md_beauty.cli import pick_port


def _busy_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    return sock, sock.getsockname()[1]


def test_free_port_is_used_as_is():
    sock, port = _busy_port()
    sock.close()
    assert pick_port("127.0.0.1", port, explicit=True) == port


def test_busy_default_port_moves_to_the_next_free_one():
    sock, port = _busy_port()
    with sock:
        chosen = pick_port("127.0.0.1", port, explicit=False)
    assert chosen > port


def test_busy_port_the_user_asked_for_stops_with_a_message():
    sock, port = _busy_port()
    with sock, pytest.raises(SystemExit, match=f"port {port} is already in use"):
        pick_port("127.0.0.1", port, explicit=True)
