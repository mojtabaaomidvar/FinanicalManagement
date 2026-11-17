"""Serve the real API with isolated local sandbox settings."""

from local_sandbox import configure_sandbox, report_failure


if __name__ == "__main__":
    try:
        configure_sandbox()
        import uvicorn

        uvicorn.run("app.main:app", host="127.0.0.1", port=5800)
    except Exception as exc:
        report_failure(exc)
        raise SystemExit(1) from None
