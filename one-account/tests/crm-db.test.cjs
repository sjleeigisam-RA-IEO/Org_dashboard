'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const crm = require('../lib/crm-db.cjs');

const update = patch => ({
  action: 'update', entity: 'gift_recipient', id: 'synthetic-gift',
  expectedRevision: 1, requestId: randomUUID(), patch,
});
const create = patch => ({
  ...update({ person_id: 'synthetic-person', campaign_id: 'synthetic-campaign', ...patch }),
  action: 'create', expectedRevision: 0,
});

test('sending target accepts O/X contract values and an explicit unknown without altering actuals', () => {
  for (const send_target of ['yes', 'no', null]) {
    for (const request of [update({ send_target }), create({ send_target })]) {
      const before = structuredClone(request);
      assert.strictEqual(crm.commitBody(request), request);
      assert.deepEqual(request, before);
      for (const field of ['plan_status', 'delivery_status', 'received_status', 'actual_amount', 'sent_on', 'received_on']) {
        assert.equal(Object.hasOwn(request.patch, field), false);
      }
    }
  }
});

test('invalid sending decisions cannot be coerced into yes, no or unknown', () => {
  for (const send_target of ['O', 'X', 'unknown', '', 'YES', ' no ', true, false, 0, 1, [], {}]) {
    assert.throws(() => crm.commitBody(update({ send_target })), /BAD_BODY/);
    assert.throws(() => crm.commitBody(create({ send_target })), /BAD_BODY/);
  }
});

test('older gift requests omit the new field and preserve independent planning and delivery states', () => {
  for (const request of [create({}), create({ plan_status: 'listed' }), update({ item_id: null }), update({ delivery_status: 'sent', sent_on: '2026-09-15' })]) {
    const before = structuredClone(request);
    assert.doesNotThrow(() => crm.commitBody(request));
    assert.deepEqual(request, before);
    assert.equal(Object.hasOwn(request.patch, 'send_target'), false);
  }
  assert.doesNotThrow(() => crm.commitBody(update({ send_target: 'no', delivery_status: 'unknown' })));
  assert.doesNotThrow(() => crm.commitBody(update({ send_target: 'yes', plan_status: 'proposed' })));
});

test('sending target cannot be written through another entity or bypass gift ownership requirements', () => {
  for (const entity of ['person', 'affiliation', 'contact_point', 'preference', 'life_event']) {
    assert.throws(() => crm.commitBody({ ...update({ send_target: 'yes' }), entity }), /BAD_BODY/);
  }
  for (const patch of [{ send_target: 'yes' }, { person_id: 'synthetic-person', send_target: 'yes' }]) {
    assert.throws(() => crm.commitBody({ ...create({}), patch }), /BAD_BODY/);
  }
  assert.throws(() => crm.commitBody(update({ send_target: 'yes', source_record_id: 'synthetic-source' })), /BAD_BODY/);
});

test('account, person and bounded search responses preserve nullable target and populated related records', () => {
  const gift = { recipient_id: 'synthetic-gift', send_target: null, delivery_status: 'unknown' };
  const detail = {
    person_id: 'synthetic-person', affiliation_id: 'synthetic-affiliation',
    contact_points: [{ kind: 'email', value: 'synthetic@example.invalid' }],
    receiving_preferences: [{ availability: 'no', scope: 'campaign' }],
    gift_recipients: [gift],
  };
  const fixtures = {
    account: { status: 'ok', account: {}, people: [detail] },
    search: { status: 'ok', people: [detail], truncated: false },
    person: { status: 'ok', person: {}, affiliations: [], contact_points: detail.contact_points, receiving_preferences: detail.receiving_preferences,
      life_events: [], gift_recipients: [gift], field_claims: [], source_records: [], audit: [] },
  };
  for (const [action, fixture] of Object.entries(fixtures)) {
    const before = structuredClone(fixture);
    assert.strictEqual(crm.readView(fixture, action), fixture);
    assert.deepEqual(fixture, before);
  }
});
