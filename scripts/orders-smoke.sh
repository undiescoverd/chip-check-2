#!/usr/bin/env bash
#
# Phase 1 integration smoke test for the orders API (§13).
#
#   scripts/orders-smoke.sh <baseUrl> [shopId]
#
# Requires:
#   E2E_STAFF_PIN         the shop's staff PIN — exchanged for a cc_staff cookie (§7.2)
#   CRON_SECRET           optional — if set, the cron route is exercised too
#
# The shop must exist and have that PIN set. Seed it first:
#   node scripts/seed-shop.mjs --slug=test-shop --pin=4321
#
# Works against any base URL: a Vercel Preview, or a locally served build running against
# the emulator. Every assertion prints PASS or FAIL and the script exits non-zero if any
# failed, so it is usable both by eye and in CI.

set -uo pipefail

BASE_URL="${1:-}"
SHOP_ID="${2:-test-shop}"

if [[ -z "$BASE_URL" ]]; then
  echo "usage: $0 <baseUrl> [shopId]" >&2
  exit 64
fi
if [[ -z "${E2E_STAFF_PIN:-}" ]]; then
  echo "E2E_STAFF_PIN must be set (the shop's staff PIN)" >&2
  exit 64
fi

BASE_URL="${BASE_URL%/}"
ENDPOINT="$BASE_URL/api/shops/$SHOP_ID/orders"
UNLOCK="$BASE_URL/api/shops/$SHOP_ID/staff/unlock"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT
PASSED=0
FAILED=0

# A number unlikely to collide with anything already on the board.
NUM="$(( (RANDOM % 9000) + 1000 ))"

# Vercel Preview deployments can sit behind Deployment Protection; the bypass header is
# set only when the secret is available (runbook step 3.6).
BYPASS_ARGS=()
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  BYPASS_ARGS=(-H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET")
fi

# call <body> [extra curl args...] -> sets STATUS and BODY
call() {
  local body="$1"; shift
  local response
  response="$(curl -sS -o - -w $'\n%{http_code}' \
    -X POST "$ENDPOINT" \
    -H "content-type: application/json" \
    -b "$COOKIE_JAR" \
    "${BYPASS_ARGS[@]}" \
    "$@" \
    --data-binary "$body" 2>/dev/null)"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

check() {
  local label="$1" expected_status="$2" expected_error="${3:-}"
  local ok=1

  [[ "$STATUS" == "$expected_status" ]] || ok=0
  if [[ -n "$expected_error" ]] && [[ "$BODY" != *"\"error\":\"$expected_error\""* ]]; then
    ok=0
  fi

  if [[ $ok == 1 ]]; then
    echo "PASS  $label  ($STATUS)"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL  $label  expected $expected_status${expected_error:+/$expected_error}, got $STATUS"
    echo "      body: $BODY"
    FAILED=$((FAILED + 1))
  fi
}

# Pull a field out of a JSON body without assuming jq is installed.
json_field() {
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"
}

echo "Orders API smoke test"
echo "  endpoint: $ENDPOINT"
echo "  number:   $NUM"
echo

# --- authentication (§7.2) --------------------------------------------------------
# No cookie at all.
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$ENDPOINT" \
  -H "content-type: application/json" "${BYPASS_ARGS[@]}" \
  --data-binary "{\"action\":\"add\",\"orderNumber\":\"$NUM\"}" 2>/dev/null)"
BODY=""
check "no auth is refused" 401

# A wrong PIN must not unlock, and must not leak which part was wrong.
RESPONSE="$(curl -sS -o - -w $'\n%{http_code}' -X POST "$UNLOCK" \
  -H "content-type: application/json" "${BYPASS_ARGS[@]}" \
  --data-binary '{"pin":"000000"}' 2>/dev/null)"
STATUS="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"
check "wrong PIN is refused" 401 "invalid_pin"

# The real unlock. -c writes the cc_staff cookie into the jar every later call uses.
RESPONSE="$(curl -sS -o - -w $'\n%{http_code}' -X POST "$UNLOCK" \
  -H "content-type: application/json" -c "$COOKIE_JAR" "${BYPASS_ARGS[@]}" \
  --data-binary "{\"pin\":\"$E2E_STAFF_PIN\"}" 2>/dev/null)"
STATUS="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"
check "unlock with the right PIN" 200

if grep -q "cc_staff" "$COOKIE_JAR" 2>/dev/null; then
  echo "PASS  the unlock set a cc_staff cookie"
  PASSED=$((PASSED + 1))
else
  echo "FAIL  the unlock did not set a cc_staff cookie; nothing below can pass"
  FAILED=$((FAILED + 1))
  echo
  echo "passed: $PASSED   failed: $FAILED"
  exit 1
fi

# A cookie is scoped to one shop by its signature (Phase 2 DoD).
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$BASE_URL/api/shops/no-such-other-shop/orders" \
  -H "content-type: application/json" -b "$COOKIE_JAR" "${BYPASS_ARGS[@]}" \
  --data-binary '{"action":"add","orderNumber":"1"}' 2>/dev/null)"
BODY=""
check "this shop's cookie is refused on another shop" 401

# --- validation -------------------------------------------------------------------
call '{ this is not json'
check "malformed JSON" 400 "invalid_json"

call '{"action":"markReady"}'
check "schema failure" 400 "invalid_body"

call '{"action":"purgeStale"}'
check "unknown action" 400 "invalid_body"

call '{"action":"add","orderNumber":"1234567"}'
check "order number outside the shop digit rule" 400 "invalid_order_number"

# --- the happy path ---------------------------------------------------------------
call "{\"action\":\"add\",\"orderNumber\":\"$NUM\"}"
check "add" 200
ORDER_ID="$(json_field "$BODY" id)"
if [[ -z "$ORDER_ID" ]]; then
  echo "FAIL  add did not return an order id; cannot continue"
  exit 1
fi
echo "      order id: $ORDER_ID"

call "{\"action\":\"add\",\"orderNumber\":\"$NUM\"}"
check "duplicate add" 409 "duplicate_order"

call "{\"action\":\"markReady\",\"id\":\"$ORDER_ID\"}"
check "markReady" 200

call "{\"action\":\"markReady\",\"id\":\"$ORDER_ID\"}"
check "markReady twice" 409 "invalid_transition"

call "{\"action\":\"recall\",\"id\":\"$ORDER_ID\"}"
check "recall" 200

call "{\"action\":\"recall\",\"id\":\"$ORDER_ID\"}"
check "recall a preparing order" 409 "invalid_transition"

call "{\"action\":\"markReady\",\"id\":\"$ORDER_ID\"}"
check "markReady again" 200

call "{\"action\":\"clear\",\"id\":\"$ORDER_ID\"}"
check "clear" 200

call "{\"action\":\"clear\",\"id\":\"$ORDER_ID\"}"
check "clear twice" 409 "invalid_transition"

# --- undo (§13, the amendment) ----------------------------------------------------
call "{\"action\":\"unclear\",\"id\":\"$ORDER_ID\"}"
check "unclear restores the order" 200
if [[ "$BODY" == *'"status":"ready"'* ]]; then
  echo "PASS  an order cleared while ready comes back ready"
  PASSED=$((PASSED + 1))
else
  echo "FAIL  an order cleared while ready came back as: $BODY"
  FAILED=$((FAILED + 1))
fi

call "{\"action\":\"clear\",\"id\":\"$ORDER_ID\"}"
check "clear again after the undo" 200

call "{\"action\":\"add\",\"orderNumber\":\"$NUM\"}"
check "the number is free again after a clear" 200
REPLACEMENT_ID="$(json_field "$BODY" id)"

call "{\"action\":\"unclear\",\"id\":\"$ORDER_ID\"}"
check "undo after the number was re-added" 409 "duplicate_order"

call "{\"action\":\"unclear\",\"id\":\"nosuchorder\"}"
check "undo of an unknown order" 404 "order_not_found"

# --- clearAll ---------------------------------------------------------------------
call '{"action":"clearAll","status":"ready","olderThanSeconds":999999}'
check "shed nudge with a filter nothing matches" 200
if [[ "$BODY" == *'"cleared":0'* ]]; then
  echo "PASS  the filter matched nothing, as expected"
  PASSED=$((PASSED + 1))
else
  echo "FAIL  expected cleared:0, got: $BODY"
  FAILED=$((FAILED + 1))
fi

call '{"action":"clearAll"}'
check "clearAll" 200

# --- the dedupe race --------------------------------------------------------------
# Two adds fired at once: exactly one must win. This is the assertion the activeNumbers
# lock exists for.
RACE_NUM="$(( (RANDOM % 9000) + 1000 ))"
RACE_DIR="$(mktemp -d)"
for i in 1 2; do
  (
    # The trailing newline matters: without it the two files concatenate into one token.
    curl -sS -o /dev/null -w $'%{http_code}\n' -X POST "$ENDPOINT" \
      -H "content-type: application/json" \
      -b "$COOKIE_JAR" \
      "${BYPASS_ARGS[@]}" \
      --data-binary "{\"action\":\"add\",\"orderNumber\":\"$RACE_NUM\"}" \
      > "$RACE_DIR/$i" 2>/dev/null
  ) &
done
wait

RACE_CODES="$(cat "$RACE_DIR"/1 "$RACE_DIR"/2 | sort | tr '\n' ' ')"
rm -rf "$RACE_DIR"
if [[ "$RACE_CODES" == "200 409 " ]]; then
  echo "PASS  two concurrent adds: exactly one 200 and one 409"
  PASSED=$((PASSED + 1))
else
  echo "FAIL  two concurrent adds returned: $RACE_CODES"
  FAILED=$((FAILED + 1))
fi

# --- cron -------------------------------------------------------------------------
CRON_URL="$BASE_URL/api/cron/purge-stale"
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BYPASS_ARGS[@]}" "$CRON_URL" 2>/dev/null)"
BODY=""
check "cron without a bearer token" 401

if [[ -n "${CRON_SECRET:-}" ]]; then
  RESPONSE="$(curl -sS -o - -w $'\n%{http_code}' \
    -H "authorization: Bearer $CRON_SECRET" "${BYPASS_ARGS[@]}" "$CRON_URL" 2>/dev/null)"
  STATUS="${RESPONSE##*$'\n'}"
  BODY="${RESPONSE%$'\n'*}"
  check "cron with the bearer token" 200
else
  echo "SKIP  cron with the bearer token (CRON_SECRET not set)"
fi

# --- PIN lockout (§7.2 step 3) ----------------------------------------------------
# Deliberately last: it locks this IP out of the shop for 15 minutes, so nothing after
# it could unlock. Five wrong PINs are allowed; the sixth is refused.
for i in 1 2 3 4 5; do
  curl -sS -o /dev/null -X POST "$UNLOCK" \
    -H "content-type: application/json" "${BYPASS_ARGS[@]}" \
    --data-binary '{"pin":"000000"}' 2>/dev/null
done

RESPONSE="$(curl -sS -o - -w $'\n%{http_code}' -X POST "$UNLOCK" \
  -H "content-type: application/json" "${BYPASS_ARGS[@]}" \
  --data-binary '{"pin":"000000"}' 2>/dev/null)"
STATUS="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"
check "sixth wrong PIN in the window is locked out" 429 "pin_locked"

if [[ "$BODY" == *'"retryAfterSeconds"'* ]]; then
  echo "PASS  the lockout says how long to wait"
  PASSED=$((PASSED + 1))
else
  echo "FAIL  the lockout carried no retryAfterSeconds: $BODY"
  FAILED=$((FAILED + 1))
fi

# Even the correct PIN is refused while locked out.
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$UNLOCK" \
  -H "content-type: application/json" "${BYPASS_ARGS[@]}" \
  --data-binary "{\"pin\":\"$E2E_STAFF_PIN\"}" 2>/dev/null)"
BODY=""
check "the right PIN is refused while locked out" 429

# --- cleanup ----------------------------------------------------------------------
if [[ -n "${REPLACEMENT_ID:-}" ]]; then
  call "{\"action\":\"clear\",\"id\":\"$REPLACEMENT_ID\"}" > /dev/null
fi

echo
echo "passed: $PASSED   failed: $FAILED"
[[ $FAILED -eq 0 ]]
