#!/usr/bin/env python3
"""Upload 向阳王.json to fnOS Koishi as hidamari.json and restart the bot."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import paramiko

HOST = os.environ.get("NAS_HOST", "123.122.167.229")
USER = os.environ.get("NAS_USER", "xiaotian")
PASSWORD = os.environ.get("NAS_PASS", "")
REMOTE_DIR = "/vol1/1002/docker/koishi/data/answerData"
REMOTE_FILE = REMOTE_DIR + "/hidamari.json"
TMP = "/tmp/hidamari.json"
LOCAL = Path(__file__).resolve().parents[1] / "data" / "answerData" / "向阳王.json"


def die(msg: str, code: int = 1) -> None:
    raise SystemExit(f"[upload] ERROR: {msg}")


def sudo(ssh: paramiko.SSHClient, cmd: str) -> str:
    full = f"echo '{PASSWORD}' | sudo -S -p '' bash -lc {json.dumps(cmd)}"
    print("[upload]", cmd)
    _i, stdout, _e = ssh.exec_command(full, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    print(out.rstrip()[:3500])
    return out


def main() -> None:
    if not PASSWORD:
        die("set NAS_PASS env var")
    if not LOCAL.is_file():
        die(f"missing {LOCAL}")
    data = LOCAL.read_bytes()
    bank = json.loads(data.decode("utf-8"))
    print("[local] guild=", bank.get("guild"), "n=", len(bank.get("content") or {}))

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = ssh.open_sftp()
    with sftp.file(TMP, "wb") as f:
        f.write(data)
    sftp.close()

    sudo(ssh, f"mkdir -p {REMOTE_DIR} && cp {TMP} {REMOTE_FILE} && chmod 644 {REMOTE_FILE}")
    sudo(ssh, f"python3 -c \"import json; d=json.load(open('{REMOTE_FILE}')); print(d.get('guild'), len(d.get('content') or {{}}))\"")
    sudo(ssh, "docker restart koishi")
    time.sleep(4)
    sudo(ssh, "docker logs koishi --tail 20")
    ssh.close()
    print("[upload] done")


if __name__ == "__main__":
    main()
