#!/usr/bin/env python3
# Native Messaging host for KP Extension — runs git pull in ext directory
import sys, json, struct, subprocess, os

EXT_DIR = os.path.join(os.path.expanduser('~'), 'kp-extension')

def send_msg(msg):
    data = json.dumps(msg, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
    sys.stdout.buffer.flush()

def recv_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack('<I', raw)[0]
    return json.loads(sys.stdin.buffer.read(length).decode('utf-8'))

msg = recv_msg()
if not msg:
    sys.exit(0)

if msg.get('action') == 'ping':
    send_msg({'ok': True, 'version': '1.0', 'ext_dir': EXT_DIR})

elif msg.get('action') == 'update':
    if not os.path.isdir(os.path.join(EXT_DIR, '.git')):
        send_msg({'ok': False, 'output': f'Папка {EXT_DIR} не найдена'})
        sys.exit(0)
    try:
        result = subprocess.run(
            ['git', 'pull', 'origin', 'main'],
            cwd=EXT_DIR,
            capture_output=True,
            text=True,
            timeout=30
        )
        output = (result.stdout + result.stderr).strip()
        send_msg({'ok': result.returncode == 0, 'output': output})
    except subprocess.TimeoutExpired:
        send_msg({'ok': False, 'output': 'Превышено время ожидания (30 с)'})
    except FileNotFoundError:
        send_msg({'ok': False, 'output': 'Git не найден. Установите git.'})
    except Exception as e:
        send_msg({'ok': False, 'output': str(e)})
