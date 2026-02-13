"""Diagnostic 2 — deeper look at failing endpoints."""
import json, os
from linkedin_api import Linkedin

email = os.environ.get("LINKEDIN_EMAIL", "annabelleivy71@gmail.com")
password = os.environ.get("LINKEDIN_PASSWORD", "aSk0T0wjEn1e3!2")

print("=== Authenticating ===")
api = Linkedin(email, password)
print("OK\n")

# conversations — what status?
print("=== get_conversations() — full raw ===")
raw = api.get_conversations()
print(json.dumps(raw, indent=2, default=str)[:1000])
print()

# get_profile — catch the real error
print("=== get_profile('annabelle-ivy-7847b13a9') ===")
try:
    p = api.get_profile("annabelle-ivy-7847b13a9")
    print(f"Success! Keys: {list(p.keys())}")
    print(f"profile_id={p.get('profile_id')}, public_id={p.get('public_id')}")
except Exception as e:
    print(f"Error type: {type(e).__name__}: {e}")
    # Try raw fetch
    print("  Trying raw _fetch...")
    try:
        res = api._fetch(f"/identity/profiles/annabelle-ivy-7847b13a9/profileView")
        print(f"  Raw status: {res.status_code}")
        print(f"  Raw body: {json.dumps(res.json(), default=str)[:500]}")
    except Exception as e2:
        print(f"  Raw fetch error: {e2}")
print()

# feed — try different approach
print("=== get_feed_posts raw ===")
posts = api.get_feed_posts(limit=3)
print(f"Type: {type(posts)}, len: {len(posts) if isinstance(posts, list) else 'N/A'}")
if isinstance(posts, list) and posts:
    print(json.dumps(posts[0], indent=2, default=str)[:1500])
else:
    print("Empty — trying raw feed endpoint...")
    try:
        res = api._fetch("/feed/updatesV2?count=3&q=feed")
        print(f"  Raw status: {res.status_code}")
        body = res.json()
        print(f"  Keys: {list(body.keys()) if isinstance(body, dict) else type(body)}")
        print(json.dumps(body, default=str)[:500])
    except Exception as e:
        print(f"  Raw fetch error: {e}")
print()

# send_message — can we send if we have the URN?
print("=== send_message with URN directly ===")
urn = "ACoAAB0v6boBDAaf-6lt4wJHRx3cTPeRQpB93-I"
try:
    err = api.send_message(message_body="Hi Tomasz, this is a test from Annabelle!", recipients=[urn])
    print(f"send_message returned: {err}")
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}")
