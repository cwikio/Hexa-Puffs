"""Diagnostic script — see what the linkedin-api actually returns."""
import json, os, sys
from linkedin_api import Linkedin

email = os.environ.get("LINKEDIN_EMAIL", "annabelleivy71@gmail.com")
password = os.environ.get("LINKEDIN_PASSWORD", "aSk0T0wjEn1e3!2")

print("=== Authenticating ===")
api = Linkedin(email, password)
print("OK\n")

# 1. /me
print("=== get_user_profile() ===")
me = api.get_user_profile()
print(json.dumps(me, indent=2, default=str)[:3000])
print()

# 2. search_people
print("=== search_people(keywords='Tomasz Cwik', limit=5) ===")
results = api.search_people(keywords="Tomasz Cwik", limit=5)
print(f"Count: {len(results)}")
for r in results:
    print(json.dumps(r, default=str))
print()

print("=== search_people(keyword_first_name='Tomasz', keyword_last_name='Cwik', include_private_profiles=True, network_depths=['F','S','O']) ===")
results2 = api.search_people(
    keyword_first_name="Tomasz", keyword_last_name="Cwik",
    include_private_profiles=True, network_depths=["F", "S", "O"], limit=5,
)
print(f"Count: {len(results2)}")
for r in results2:
    print(json.dumps(r, default=str))
print()

# 3. get_conversations - raw structure
print("=== get_conversations() — raw keys + first conversation structure ===")
raw_convs = api.get_conversations()
if isinstance(raw_convs, dict):
    print(f"Type: dict, keys: {list(raw_convs.keys())}")
    elements = raw_convs.get("elements", [])
    print(f"Elements count: {len(elements)}")
    if elements:
        first = elements[0]
        print(f"First conv keys: {list(first.keys())}")
        print(f"Participants: {json.dumps(first.get('participants', []), indent=2, default=str)[:2000]}")
elif isinstance(raw_convs, list):
    print(f"Type: list, length: {len(raw_convs)}")
    if raw_convs:
        first = raw_convs[0]
        print(f"First conv keys: {list(first.keys())}")
        print(f"Participants: {json.dumps(first.get('participants', []), indent=2, default=str)[:2000]}")
else:
    print(f"Type: {type(raw_convs)}")
print()

# 4. get_feed_posts
print("=== get_feed_posts(limit=3) ===")
try:
    posts = api.get_feed_posts(limit=3)
    print(f"Type: {type(posts)}, count: {len(posts) if isinstance(posts, list) else 'N/A'}")
    if isinstance(posts, list) and posts:
        first_post = posts[0]
        print(f"First post keys: {list(first_post.keys())}")
        print(json.dumps(first_post, indent=2, default=str)[:2000])
    elif isinstance(posts, dict):
        print(f"Dict keys: {list(posts.keys())}")
        print(json.dumps(posts, indent=2, default=str)[:2000])
except Exception as e:
    print(f"ERROR: {e}")
print()

# 5. get_profile for known public_id
print("=== get_profile('annabelle-ivy-7847b13a9') ===")
try:
    profile = api.get_profile("annabelle-ivy-7847b13a9")
    print(f"Keys: {list(profile.keys())}")
    print(f"profile_id: {profile.get('profile_id')}")
    print(f"member_urn: {profile.get('member_urn')}")
    print(f"public_id: {profile.get('public_id')}")
except Exception as e:
    print(f"ERROR: {e}")
