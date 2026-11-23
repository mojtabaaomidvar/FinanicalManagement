"""Exercise the real installer URL allowlist, not a mocked high-level api call."""
import pytest

from ai_gateway import install


@pytest.mark.parametrize('name', ['plan', 'report'])
@pytest.mark.parametrize('origin', [False, True])
def test_contextual_diagnostics_reach_only_approved_https_route(monkeypatch, name, origin):
    class Response:
        status = 422
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            pass
        def read(self, _size):
            return b'{"error":"AI_GATEWAY_INVALID_REQUEST"}'
    requests = []
    class Opener:
        def open(self, request, timeout):
            requests.append(request)
            return Response()
    monkeypatch.setattr(install.urllib.request, 'build_opener', lambda *_args: Opener())
    path = f'https://{install.HOST}/ai-gateway/v1/assistant/{name}'
    assert install.api(path, body={}, origin=origin) == (
        422, {'error': 'AI_GATEWAY_INVALID_REQUEST'},
    )
    assert [request.full_url for request in requests] == [path]
