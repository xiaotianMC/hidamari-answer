#!/usr/bin/env python3
"""Tune NAS Koishi/NapCat memory: disable unused plugins, cap container RAM.

Does not restart NapCat (avoids QQ re-login).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ENV_FILE = Path(__file__).resolve().parent.parent / ".nas-deploy.env"
REMOTE_YML = "/vol1/1002/docker/koishi/koishi.yml"


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

DISABLE = [
    ("    analytics:qstzbk: {}", "    ~analytics:qstzbk: {}"),
    ("    explorer:rea3zc: {}", "    ~explorer:rea3zc: {}"),
    ("    insight:w0rw7k: {}", "    ~insight:w0rw7k: {}"),
    ("    oobe:cu91wk: {}", "    ~oobe:cu91wk: {}"),
    ("    sandbox:2m6ns5: {}", "    ~sandbox:2m6ns5: {}"),
    ("    telemetry:wcczp8: {}", "    ~telemetry:wcczp8: {}"),
]

SLEEP_BLOCK = (
    "    debug: false\n"
    "    sleep:\n"
    "      enabled: true\n"
    "      idleMinutes: 10\n"
    "      startAsleep: true\n"
    "      unloadQuiz: true\n"
    "      autoEndIdleGameMinutes: 10\n"
)


def run(ssh, cmd: str, check: bool = True, quiet: bool = False) -> tuple[int, str]:
    shown = cmd
    if "sudo -S" in cmd:
        shown = cmd.split("sudo -S -p '' ", 1)[-1]
    print(f"[tune] $ {shown}")
    _in, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    text = (out + err).strip()
    if text and not quiet:
        print(text)
    if check and code != 0:
        print(f"[tune] ERROR ({code})", file=sys.stderr)
        sys.exit(code)
    return code, text


def sudo(ssh, cmd: str, check: bool = True, quiet: bool = False) -> tuple[int, str]:
    escaped = PASSWORD.replace("'", "'\"'\"'")
    return run(ssh, f"echo '{escaped}' | sudo -S -p '' {cmd}", check=check, quiet=quiet)


def patch_yml(text: str) -> tuple[str, list[str]]:
    changes = []
    for old, new in DISABLE:
        if old in text and new not in text:
            text = text.replace(old, new, 1)
            changes.append(new.strip())
        elif new in text:
            changes.append(f"(already) {new.strip()}")
    if "smmcat-answer:" in text:
        text = text.replace("smmcat-answer:", "hidamari-question:")
        changes.append("plugin key hidamari-question")
    if "hidamari-question" in text and "debug: true" in text:
        text = text.replace("    debug: true\n", "    debug: false\n", 1)
        changes.append("debug: false")
    if "hidamari-question" in text and "\n    sleep:\n" not in text:
        if "    debug: false\n" in text:
            text = text.replace("    debug: false\n", SLEEP_BLOCK, 1)
            changes.append("sleep: added")
    return text, changes


def main():
    if not PASSWORD:
        print("set NAS_PASS", file=sys.stderr)
        sys.exit(1)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)

    _code, raw = sudo(ssh, f"cat {REMOTE_YML}", quiet=True)
    # strip sudo noise
    lines = raw.splitlines()
    while lines and (
        lines[0].startswith("Could not chdir")
        or lines[0].startswith("[sudo]")
        or lines[0].startswith("Password")
    ):
        lines.pop(0)
    original = "\n".join(lines) + ("\n" if raw.endswith("\n") else "")
    patched, changes = patch_yml(original)
    print("[tune] koishi.yml changes:")
    for c in changes:
        print(f"  - {c}")

    if patched != original:
        sudo(ssh, f"cp {REMOTE_YML} {REMOTE_YML}.bak-memory")
        sftp = ssh.open_sftp()
        tmp = "/tmp/koishi.yml.memory"
        with sftp.file(tmp, "w") as f:
            f.write(patched)
        sftp.close()
        sudo(ssh, f"cp {tmp} {REMOTE_YML}")
        run(ssh, f"rm -f {tmp}", check=False)
        print("[tune] koishi.yml written")
    else:
        print("[tune] koishi.yml unchanged")

    sudo(ssh, "docker update --memory 256m --memory-swap 256m koishi")
    sudo(ssh, "docker update --memory 512m --memory-swap 512m napcat")
    sudo(ssh, "docker restart koishi")
    import time
    time.sleep(8)
    sudo(ssh, "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' koishi napcat")
    ssh.close()
    print("[tune] done")


if __name__ == "__main__":
    main()
