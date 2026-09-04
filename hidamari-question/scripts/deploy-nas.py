#!/usr/bin/env python3
"""Deploy local hidamari-question plugin to fnOS Koishi volume via SSH/SFTP."""
from __future__ import annotations

import io
import os
import sys
import tarfile
import time

import paramiko

HOST = os.environ.get("NAS_HOST", "123.122.167.229")
USER = os.environ.get("NAS_USER", "xiaotian")
PASSWORD = os.environ.get("NAS_PASS", "")
PORT = int(os.environ.get("NAS_PORT", "22"))

PLUGIN_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REMOTE_KOISHI = "/vol1/1002/docker/koishi"
REMOTE_PLUGIN = f"{REMOTE_KOISHI}/node_modules/koishi-plugin-hidamari-question"
REMOTE_TMP = "/tmp/hidamari-question-deploy.tgz"


def die(msg: str, code: int = 1):
    print(f"[deploy] ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def make_tarball() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        pkg = os.path.join(PLUGIN_DIR, "package.json")
        if not os.path.isfile(pkg):
            die("package.json missing")
        tar.add(pkg, arcname="package.json")
        lib = os.path.join(PLUGIN_DIR, "lib")
        if not os.path.isdir(lib):
            die("lib/ missing — run npm run build first")
        for root, _dirs, files in os.walk(lib):
            for name in files:
                full = os.path.join(root, name)
                arc = os.path.relpath(full, PLUGIN_DIR).replace("\\", "/")
                tar.add(full, arcname=arc)
    return buf.getvalue()


def _redact(cmd: str) -> str:
    if PASSWORD:
        return cmd.replace(PASSWORD, "***")
    return cmd


def run(ssh: paramiko.SSHClient, cmd: str, check: bool = True) -> tuple[int, str, str]:
    print(f"[deploy] $ {_redact(cmd)}")
    _stdin, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    if check and code != 0:
        die(f"command failed ({code}): {cmd}\n{out}\n{err}")
    return code, out, err


def sudo(ssh: paramiko.SSHClient, cmd: str, check: bool = True) -> tuple[int, str, str]:
    # Prefer passwordless sudo; fall back to echo password
    code, out, err = run(ssh, f"sudo -n {cmd}", check=False)
    if code == 0:
        return code, out, err
    escaped = PASSWORD.replace("'", "'\"'\"'")
    return run(ssh, f"echo '{escaped}' | sudo -S -p '' {cmd}", check=check)


def main():
    if not PASSWORD:
        die("set NAS_PASS env var")

    data = make_tarball()
    print(f"[deploy] tarball size: {len(data)} bytes")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[deploy] connecting {USER}@{HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)

    # Probe layout
    run(ssh, f"ls -la {REMOTE_KOISHI}/node_modules/koishi-plugin-hidamari-question 2>/dev/null || ls -la {REMOTE_KOISHI}/node_modules 2>/dev/null | head -40", check=False)
    run(ssh, "docker ps --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null || true", check=False)

    sftp = ssh.open_sftp()
    print(f"[deploy] uploading -> {REMOTE_TMP}")
    with sftp.file(REMOTE_TMP, "wb") as f:
        f.write(data)
    sftp.close()

    # 目录属主多为 root，用 sudo 解压覆盖
    sudo(ssh, f"mkdir -p {REMOTE_PLUGIN}")
    sudo(ssh, f"tar -xzf {REMOTE_TMP} -C {REMOTE_PLUGIN}")
    run(ssh, f"rm -f {REMOTE_TMP}", check=False)
    sudo(ssh, f"rm -rf {REMOTE_KOISHI}/node_modules/koishi-plugin-smmcat-answer", check=False)
    sudo(ssh, f"sed -i 's/smmcat-answer:/hidamari-question:/g' {REMOTE_KOISHI}/koishi.yml", check=False)

    # 校验：版本号 + 新指令是否存在
    run(ssh, f"grep -o '\"version\": \"[^\"]*\"' {REMOTE_PLUGIN}/package.json | head -1")
    run(ssh, f"grep -c '答题记录' {REMOTE_PLUGIN}/lib/index.js")
    run(ssh, f"grep -c '注销' {REMOTE_PLUGIN}/lib/index.js")
    run(ssh, f"grep -c '已收到你的答案' {REMOTE_PLUGIN}/lib/index.js")
    run(ssh, f"grep -c 'mqqapi' {REMOTE_PLUGIN}/lib/index.js")
    run(ssh, f"grep -c 'jumpToQuestion' {REMOTE_PLUGIN}/lib/index.js")
    run(ssh, f"grep -c 'sendMarkdownInDoubleForward' {REMOTE_PLUGIN}/lib/index.js")
    run(ssh, f"grep -c 'ensureRegistered' {REMOTE_PLUGIN}/lib/index.js")
    run(ssh, f"grep -c 'enterSleep' {REMOTE_PLUGIN}/lib/index.js")
    run(ssh, f"grep -c '休眠状态' {REMOTE_PLUGIN}/lib/index.js")

    # 只重启 Koishi 以加载新插件；不重启 NapCat（省内存、避免 QQ 掉登录）
    code, _out, _err = run(ssh, "docker restart koishi", check=False)
    if code != 0:
        print("[deploy] retrying with sudo docker restart koishi ...")
        sudo(ssh, "docker restart koishi")

    time.sleep(8)
    sudo(ssh, "docker ps --filter name=koishi --filter name=napcat --format 'table {{.Names}}\\t{{.Status}}'", check=False)
    sudo(ssh, "docker logs koishi --tail 25", check=False)
    sudo(ssh, "docker logs napcat --tail 15 2>&1 | grep -iE 'WebSocket|onebot|快速登录|Western|error' | tail -8", check=False)

    ssh.close()
    print("[deploy] done")


if __name__ == "__main__":
    main()
