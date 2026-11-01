#!/usr/bin/env python3
"""Read account-wide Worker CPU/request counters without logging credentials.

CLOUDFLARE_API_TOKEN needs Analytics Read; CLOUDFLARE_ACCOUNT_ID selects the account.
Cloudflare reports CPU in microseconds. Keep raw evidence and compare against 10,000.
"""
import datetime
import json
import os
import urllib.request

now = datetime.datetime.now(datetime.timezone.utc)
query = '''query($account:string,$start:string,$end:string){viewer{accounts(filter:{accountTag:$account}){
  workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$start,datetime_leq:$end}){
    dimensions{scriptName status}sum{requests errors subrequests}quantiles{cpuTimeP50 cpuTimeP99}
  }
}}}'''
body = {"query": query, "variables": {"account": os.environ["CLOUDFLARE_ACCOUNT_ID"],
    "start": (now - datetime.timedelta(hours=1)).isoformat(), "end": now.isoformat()}}
request = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql",
    data=json.dumps(body).encode(), headers={"Content-Type": "application/json",
    "Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"]})
with urllib.request.urlopen(request, timeout=30) as response:
    result = json.load(response)
print(json.dumps(result, indent=2))
if result.get("errors"):
    raise SystemExit(1)
