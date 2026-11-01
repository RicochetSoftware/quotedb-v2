"""Convert the legacy UTC mysqldump users/quotes into an atomic PostgreSQL import.

Only literal INSERTs for these two tables are accepted; other tables are ignored.
Output contains private data: create it outside the checkout and delete after use.
"""
import argparse
import base64
import datetime as dt
import gzip
import json
import os
import re
from pathlib import Path

COLUMNS = {
    'users': ['id', 'name', 'email', 'email_verified_at', 'password', 'remember_token', 'role', 'created_at', 'updated_at', 'deleted_at'],
    'quotes': ['id', 'quote', 'author', 'user_id', 'created_at', 'updated_at', 'deleted_at'],
}
ROLES = {'user': 'USER', 'admin': 'ADMIN', 'superadmin': 'SUPER_ADMIN'}


def values(text):
    """Parse mysqldump VALUES, never evaluating executable source SQL."""
    i = 0
    def whitespace():
        nonlocal i
        while i < len(text) and text[i].isspace():
            i += 1
    def expect(char):
        nonlocal i
        whitespace()
        if i >= len(text) or text[i] != char:
            raise ValueError('Unexpected INSERT structure')
        i += 1
    rows = []
    while True:
        expect('(')
        row = []
        while True:
            whitespace()
            if i < len(text) and text[i] == "'":
                i += 1
                chars = []
                while True:
                    if i >= len(text):
                        raise ValueError('Unterminated string')
                    c = text[i]
                    i += 1
                    if c == '\\':
                        escapes = {'0': '\0', 'b': '\b', 'n': '\n', 'r': '\r', 't': '\t', 'Z': '\x1a', '\\': '\\', "'": "'", '"': '"'}
                        if i >= len(text) or text[i] not in escapes:
                            raise ValueError('Unsupported MySQL escape')
                        chars.append(escapes[text[i]])
                        i += 1
                    elif c == "'":
                        if i < len(text) and text[i] == "'":
                            chars.append("'")
                            i += 1
                        else:
                            break
                    else:
                        chars.append(c)
                row.append(''.join(chars))
            else:
                match = re.match(r'NULL\b|[0-9]+', text[i:])
                if not match:
                    raise ValueError('Unsupported SQL value')
                raw = match.group()
                row.append(None if raw == 'NULL' else int(raw))
                i += len(raw)
            whitespace()
            if i < len(text) and text[i] == ')':
                i += 1
                break
            expect(',')
        rows.append(row)
        whitespace()
        if i < len(text) and text[i] == ';':
            i += 1
            whitespace()
            if i != len(text):
                raise ValueError('Unexpected trailing SQL')
            return rows
        expect(',')


def normalize(source):
    result = {}
    for table, columns in COLUMNS.items():
        output = []
        ids = set()
        emails = set()
        for row in source[table]:
            if len(row) != len(columns):
                raise ValueError('Unexpected column count')
            row = dict(zip(columns, row))
            identifier = row['id']
            if type(identifier) is not int or not 0 < identifier <= 2147483647 or identifier in ids:
                raise ValueError('Invalid or duplicate legacy ID')
            ids.add(identifier)
            item = {'external_id': identifier}
            for key in ['created_at', 'updated_at', 'deleted_at']:
                value = row[key]
                if value is None and key == 'updated_at':
                    value = row['created_at']
                if value is None and key == 'deleted_at':
                    item[key] = None
                else:
                    item[key] = dt.datetime.strptime(value, '%Y-%m-%d %H:%M:%S').replace(tzinfo=dt.timezone.utc).isoformat()
            for key in (['name', 'email'] if table == 'users' else ['quote', 'author']):
                if not isinstance(row[key], str) or '\0' in row[key]:
                    raise ValueError('Invalid text field')
            if table == 'users':
                email = row['email'].lower()
                if not email or email in emails:
                    raise ValueError('Empty or duplicate normalized email')
                emails.add(email)
                item.update(name=row['name'], email=email, role=ROLES[row['role']])
            else:
                if row['user_id'] not in {u['external_id'] for u in result['users']}:
                    raise ValueError('Quote owner missing from dump')
                item.update(quote=row['quote'], author=row['author'], owner_external_id=row['user_id'])
            output.append(item)
        if not output:
            raise ValueError('Empty source table')
        result[table] = output
    return result


def load(path):
    with gzip.open(path, 'rt', encoding='utf-8', newline='') as f:
        dump = f.read()
    if "SET TIME_ZONE='+00:00'" not in dump or 'NO_BACKSLASH_ESCAPES' in dump:
        raise ValueError('Dump must use UTC and standard MySQL escaping')
    source = {}
    for table, expected in COLUMNS.items():
        schema = re.search(r'CREATE TABLE `' + table + r'` \(\n(.*?)\n\)', dump, re.S)
        if not schema or re.findall(r'^\s+`([^`]+)`', schema[1], re.M) != expected:
            raise ValueError('Unexpected legacy schema')
        statements = re.findall(r'^INSERT INTO `' + table + r'` VALUES (.*)$', dump, re.M)
        if not statements:
            raise ValueError('Missing INSERT')
        source[table] = [row for statement in statements for row in values(statement)]
    return normalize(source)


def sql(data):
    parts = ["BEGIN; SET LOCAL lock_timeout='15s'; SET LOCAL TIME ZONE 'UTC';", 'LOCK TABLE users, quotes IN ACCESS EXCLUSIVE MODE;', "DO $$ BEGIN IF EXISTS (SELECT FROM users) OR EXISTS (SELECT FROM quotes) THEN RAISE EXCEPTION 'Target users/quotes must be empty'; END IF; END $$;"]
    for table in COLUMNS:
        payload = base64.b64encode(json.dumps(data[table], ensure_ascii=False).encode()).decode()
        fields = {key: ('integer' if key in ('external_id', 'owner_external_id') else 'timestamptz' if key.endswith('_at') else 'text') for key in data[table][0]}
        definitions = ', '.join(f'{key} {kind}' for key, kind in fields.items())
        parts.append(f"CREATE TEMP TABLE source_{table} ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(convert_from(decode('{payload}', 'base64'), 'UTF8')::jsonb) AS x({definitions});")
    parts.append('INSERT INTO users (external_id, created_at, updated_at, deleted_at, name, email, role) SELECT external_id, created_at, updated_at, deleted_at, name, email, role FROM source_users;')
    parts.append('INSERT INTO quotes (external_id, created_at, updated_at, deleted_at, quote, author, user_id, collection_id) SELECT q.external_id, q.created_at, q.updated_at, q.deleted_at, q.quote, q.author, u.id, c.id FROM source_quotes q JOIN users u ON u.external_id=q.owner_external_id JOIN collections c ON c.personal_owner_id=u.id;')
    # Compare every imported field in both directions before committing.
    for table in COLUMNS:
        keys = list(data[table][0])
        expected = ', '.join('s.' + key for key in keys)
        actual = ', '.join('u.external_id' if key == 'owner_external_id' else 't.email::text' if key == 'email' else 't.' + key for key in keys)
        join = ' JOIN users u ON u.id=t.user_id' if table == 'quotes' else ''
        parts.append(f"DO $$ BEGIN IF EXISTS ((SELECT {expected} FROM source_{table} s EXCEPT ALL SELECT {actual} FROM {table} t{join}) UNION ALL (SELECT {actual} FROM {table} t{join} EXCEPT ALL SELECT {expected} FROM source_{table} s)) THEN RAISE EXCEPTION 'Import verification failed: {table}'; END IF; END $$;")
    parts.append('COMMIT;')
    return '\n'.join(parts) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dump', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    data = load(args.dump)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(sql(data))
    print(json.dumps({table: {'total': len(rows), 'soft_deleted': sum(row['deleted_at'] is not None for row in rows)} for table, rows in data.items()}))
