"""Read-only comparison of official DeepSeek connectivity; never uses an API key."""

from __future__ import annotations

import http.client
import os
import shutil
import socket
import subprocess
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

URL = "https://api.deepseek.com/models"
USER_AGENT = "KhanehYar-Gateway-Setup"


class IPv4Connection(http.client.HTTPSConnection):
    def __init__(self, *args, **kwargs):
        kwargs["source_address"] = ("0.0.0.0", 0)  # noqa: S104 - outgoing socket binding only
        super().__init__(*args, **kwargs)


class IPv4Handler(urllib.request.HTTPSHandler):
    def https_open(self, request):
        return self.do_open(IPv4Connection, request, context=self._context)


def urllib_probe(*, ipv4=False, direct=False):
    handlers = []
    if ipv4:
        handlers.append(IPv4Handler())
    if direct:
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(  # noqa: S310 - fixed public HTTPS models endpoint
        URL, headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with opener.open(request, timeout=8) as response:
            return "HTTP " + str(response.status)
    except urllib.error.HTTPError as error:
        return "HTTP " + str(error.code)
    except (OSError, ValueError) as error:
        return "connection error: " + type(error).__name__


def curl_probe(*, family="", app_headers=False):
    curl = shutil.which("curl")
    if not curl:
        return "curl unavailable"
    command = [curl, "--silent", "--connect-timeout", "3", "--max-time", "8",
               "--output", os.devnull, "--write-out", "%{http_code} %{remote_ip}"]
    if family:
        command.append(family)
    if app_headers:
        command += ["--user-agent", USER_AGENT, "--header", "Accept: application/json"]
    command.append(URL)
    try:
        result = subprocess.run(  # noqa: S603 - fixed curl arguments and public URL, no shell
            command, capture_output=True, text=True, timeout=10,
        )
        fields = result.stdout.strip().split()
        status = fields[0] if fields and fields[0].isdigit() else "000"
        address = fields[1] if len(fields) > 1 else ""
        network = "IPv6" if ":" in address else "IPv4" if address else "no connection"
        return f"HTTP {status}, {network}, curl exit {result.returncode}"
    except (OSError, subprocess.TimeoutExpired):
        return "curl did not complete"


def main():
    print("READ-ONLY DEEPSEEK CHECK; no key or private settings are read.", flush=True)
    print("HTTP 401 is expected without a key; this is only a network check.", flush=True)
    proxies = urllib.request.getproxies()
    print("Python proxy configured:", any(proxies.get(name) for name in ("http", "https", "all")),
          flush=True)
    probes = [
        ("CURL DEFAULT", lambda: curl_probe()),
        ("CURL IPV4", lambda: curl_probe(family="-4")),
        ("CURL IPV6", lambda: curl_probe(family="-6")),
        ("CURL APP HEADERS", lambda: curl_probe(app_headers=True)),
        ("PYTHON DEFAULT", lambda: urllib_probe()),
        ("PYTHON IPV4", lambda: urllib_probe(ipv4=True)),
        ("PYTHON DIRECT", lambda: urllib_probe(direct=True)),
    ]
    with ThreadPoolExecutor(max_workers=len(probes)) as executor:
        results = [(label, executor.submit(probe)) for label, probe in probes]
        for label, result in results:
            print(label + ": " + result.result(), flush=True)
    try:
        families = {item[0] for item in socket.getaddrinfo("api.deepseek.com", 443)}
        print("DNS address families:", ", ".join(
            name for family, name in ((socket.AF_INET, "IPv4"), (socket.AF_INET6, "IPv6"))
            if family in families
        ), flush=True)
    except OSError:
        print("DNS lookup did not complete.", flush=True)
    print("CHECK COMPLETE. Send only this output; no key is needed.", flush=True)


if __name__ == "__main__":
    main()
