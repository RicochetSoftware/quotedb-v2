#!/usr/bin/env python3
"""Warn through failed ops-check runs before shared Free quotas are exhausted."""
import datetime
import json
import os
import urllib.request

now = datetime.datetime.now(datetime.timezone.utc)
account = os.environ['CLOUDFLARE_ACCOUNT_ID']
headers = {'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN'], 'Content-Type': 'application/json'}
query = '''query($account:string,$date:string,$start:string,$end:string){viewer{accounts(filter:{accountTag:$account}){
 d1AnalyticsAdaptiveGroups(limit:1,filter:{date_geq:$date,date_leq:$date}){sum{rowsRead rowsWritten}}
 workersInvocationsAdaptive(limit:1,filter:{datetime_geq:$start,datetime_leq:$end}){sum{requests}}
}}}'''
body = {'query': query, 'variables': {'account': account, 'date': now.date().isoformat(),
    'start': now.replace(hour=0,minute=0,second=0,microsecond=0).isoformat(), 'end': now.isoformat()}}
request = urllib.request.Request('https://api.cloudflare.com/client/v4/graphql', data=json.dumps(body).encode(), headers=headers)
with urllib.request.urlopen(request, timeout=30) as response:
    result = json.load(response)
if result.get('errors'):
    raise SystemExit('Cloudflare quota analytics unavailable; inspect API permissions/schema')
data = result['data']['viewer']['accounts'][0]
d1 = data['d1AnalyticsAdaptiveGroups']
workers = data['workersInvocationsAdaptive']
usage = {'rows_read': sum(row['sum']['rowsRead'] for row in d1),
         'rows_written': sum(row['sum']['rowsWritten'] for row in d1),
         'requests': sum(row['sum']['requests'] for row in workers)}
url = f'https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{os.environ["STATUS_DATABASE_ID"]}'
with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
    database = json.load(response)
usage['database_bytes'] = database['result']['file_size']
print(json.dumps({'utc_day': now.date().isoformat(), **usage}))
limits = {'rows_read': 4_000_000, 'rows_written': 85_000, 'requests': 80_000, 'database_bytes': 400_000_000}
if any(usage[key] >= limit for key,limit in limits.items()):
    raise SystemExit('Cloudflare usage warning: inspect the status runbook and reduce load before hard quota exhaustion')
