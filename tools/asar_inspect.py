import argparse
import json
import re
import struct
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument('archive')
parser.add_argument('--match', default='.*')
parser.add_argument('--extract')
parser.add_argument('--out')
args = parser.parse_args()
archive = Path(args.archive)
with archive.open('rb') as stream:
    words = struct.unpack('<4I', stream.read(16))
    header = json.loads(stream.read(words[3]))
    base = 8 + words[1]

    def walk(tree, prefix=''):
        for name, entry in tree.get('files', {}).items():
            path = prefix + name
            if 'files' in entry:
                yield from walk(entry, path + '/')
            else:
                yield path, entry

    for path, entry in walk(header):
        if args.extract == path:
            if entry.get('unpacked'):
                content = Path(str(archive) + '.unpacked', path).read_bytes()
            else:
                stream.seek(base + int(entry['offset']))
                content = stream.read(entry['size'])
            if args.out:
                output = Path(args.out)
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(content)
                print(f'{output}: {len(content)} bytes')
            else:
                print(content.decode('utf-8'))
            break
        if not args.extract and re.search(args.match, path, re.I):
            print(f"{path}\t{entry.get('size', 0)}")
