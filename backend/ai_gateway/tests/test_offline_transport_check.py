"""The candidate image check never requires credentials or real network access."""
import socket

from ai_gateway import check


def test_offline_check_uses_real_transport_and_ignores_private_environment(monkeypatch, capsys):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "private-real-key-must-not-be-used")
    monkeypatch.setenv("AI_GATEWAY_TOKEN", "private-token-must-not-be-used")
    monkeypatch.setattr(check.sys, "argv", ["check.py", "--offline"])

    def forbidden(*_args, **_kwargs):
        raise AssertionError("An offline image check attempted external network")

    for name in ("connect", "connect_ex"):
        original = getattr(socket.socket, name)

        def guarded(sock, address, _original=original):
            # Windows' event-loop socketpair is implemented with loopback sockets.
            if isinstance(address, tuple) and address[0] in {"127.0.0.1", "::1"}:
                return _original(sock, address)
            return forbidden()

        monkeypatch.setattr(socket.socket, name, guarded)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    assert check.main() == 0
    output = capsys.readouterr().out
    assert "GATEWAY OFFLINE TRANSPORT READY" in output and "private-" not in output
