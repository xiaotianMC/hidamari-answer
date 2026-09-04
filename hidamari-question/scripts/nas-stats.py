#!/usr/bin/env python3
"""Print Koishi/NapCat docker stats (no secrets)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ENV_FILE = Path(__file__).resolve().parent.parent / ".nas-deploy.env"


def load_env():
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        key, val = trimmed.split("=", 1)
        key, val = key.strip(), val.strip()
        if key and not os.environ.get(key):
            os.environ[key] = val


load_env()
HOST = os.environ.get("NAS_HOST", "123.122.167.229")
USER = os.environ.get("NAS_USER", "xiaotian")
PASSWORD = os.environ.get("NAS_PASS", "")
PORT = int(os.environ.get("NAS_PORT", "22"))


def run(ssh, cmd: str) -> str:
    shown = cmd
    if "sudo -S" in cmd:
        shown = cmd.split("sudo -S -p '' ", 1)[-1]
    print(f"\n===== {shown} =====")
    _in, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    text = (out + err).strip()
    print(text)
    return text


def sudo(ssh, cmd: str) -> str:
    escaped = PASSWORD.replace("'", "'\"'\"'")
    return run(ssh, f"echo '{escaped}' | sudo -S -p '' {cmd}")


def main():
    if not PASSWORD:
        print("set NAS_PASS", file=sys.stderr)
        sys.exit(1)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)
    sudo(ssh, "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' koishi napcat")
    sudo(ssh, "docker inspect -f '{{.Name}} Memory={{.HostConfig.Memory}} MemorySwap={{.HostConfig.MemorySwap}}' koishi napcat")
    sudo(ssh, "du -sh /vol1/1002/docker/koishi /vol1/1002/docker/napcat /vol1/1002/docker/koishi/node_modules/koishi-plugin-hidamari-question")
    sudo(ssh, "ls -lh /vol1/1002/docker/koishi/data/answerData 2>/dev/null || true")
    sudo(ssh, "awk 'NR<=160 {print}' /vol1/1002/docker/koishi/koishi.yml")
    ssh.close()


if __name__ == "__main__":
    main()
