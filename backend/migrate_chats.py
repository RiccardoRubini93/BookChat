#!/usr/bin/env python3
"""
Migration script to normalize existing chat files under uploads/notes.
It will ensure each message has:
 - id (UUID)
 - timestamp (ISO UTC)
 - optional client_id preserved if present

Run from repository root: python3 backend/migrate_chats.py
"""
import json
import uuid
import sys
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent
NOTES_DIR = ROOT / "uploads" / "notes"

if not NOTES_DIR.exists():
    print(f"Notes dir not found: {NOTES_DIR}")
    sys.exit(0)

count_files = 0
count_msgs = 0

for f in NOTES_DIR.glob("*.chat.json"):
    count_files += 1
    try:
        with open(f, 'r') as fh:
            data = json.load(fh)
    except Exception as e:
        print(f"Skipping {f.name}: failed to load JSON: {e}")
        continue

    changed = False
    for i, m in enumerate(data):
        if not isinstance(m, dict):
            print(f"Skipping message index {i} in {f.name}, not an object")
            continue
        # add id
        if 'id' not in m:
            m['id'] = str(uuid.uuid4())
            changed = True
        # add timestamp
        if 'timestamp' not in m:
            # try to infer from file mtime
            try:
                ts = datetime.utcfromtimestamp(f.stat().st_mtime).isoformat() + 'Z'
            except Exception:
                ts = datetime.utcnow().isoformat() + 'Z'
            m['timestamp'] = ts
            changed = True
        # ensure role and content exist
        if 'role' not in m:
            m['role'] = 'user'
            changed = True
        if 'content' not in m:
            m['content'] = ''
            changed = True
        data[i] = m
        count_msgs += 1

    if changed:
        with open(f, 'w') as fh:
            json.dump(data, fh)
        print(f"Updated {f.name}")
    else:
        print(f"No changes for {f.name}")

print(f"Processed {count_files} files and {count_msgs} messages")
