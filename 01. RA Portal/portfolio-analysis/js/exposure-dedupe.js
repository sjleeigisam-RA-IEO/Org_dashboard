(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ExposureDedupe = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CONFIRMED_DUPLICATE_MARKER = /(?:중복[\s\S]{0,80}(?:합산\s*(?:시\s*)?(?:중복\s*)?제외|집계\s*제외|제외\s*(?:필요|대상|처리|확정))|(?:confirmed\s+)?duplicate|dedup)/i;
  var NEGATED_DUPLICATE_MARKER = /(?:중복\s*(?:아님|아니다|없음)|제외하지\s*않|not\s+(?:a\s+)?duplicate)/i;

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function normalizedList(values) {
    return Array.from(new Set((values || []).map(function (value) {
      return text(value).toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
    }).filter(Boolean))).sort();
  }

  function amount(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }

  function exposureId(row) {
    return text(row && (row.exposureId || row.exposure_id || row.id));
  }

  function isMarkedDuplicate(row) {
    var remarks = text(row && (row.remarks || row.remark || row.note));
    if (!remarks || NEGATED_DUPLICATE_MARKER.test(remarks)) return false;
    return CONFIRMED_DUPLICATE_MARKER.test(remarks);
  }

  function economicKey(row) {
    if (!row) return '';
    var role = text(row.role);
    var partyId = text(row.partyId || row.party_id);
    var snapshotDate = text(row.snapshotDate || row.snapshot_date || row.base_date);
    var funds = normalizedList(row.fundIds || row.fund_ids || [row.fundId || row.fund_id]);
    var assets = normalizedList(row.assetIds || row.asset_ids || [row.assetId || row.asset_id]);
    if (!assets.length) assets = normalizedList(row.assetNames || row.asset_names || [row.assetName || row.asset_name]);
    if (!role || !partyId || !snapshotDate || !funds.length || !assets.length) return '';
    return [
      role,
      partyId,
      snapshotDate,
      funds.join(','),
      assets.join(','),
      amount(row.committedAmount != null ? row.committedAmount : row.committed_amt),
      amount(row.currentAmount != null ? row.currentAmount : row.current_amt),
      amount(row.remainingAmount != null ? row.remainingAmount : row.remaining_amt)
    ].join('|');
  }

  function canonicalScore(row) {
    var score = isMarkedDuplicate(row) ? 0 : 100;
    if (text(row && (row.sourceStandardId || row.source_standard_id))) score += 20;
    if (text(row && (row.partyId || row.party_id))) score += 10;
    var id = Number(exposureId(row));
    if (Number.isFinite(id)) score += Math.max(0, 10 - id / 1000000000);
    return score;
  }

  function chooseWinner(rows) {
    return rows.slice().sort(function (a, b) {
      return canonicalScore(b) - canonicalScore(a)
        || exposureId(a).localeCompare(exposureId(b), 'en', { numeric: true });
    })[0];
  }

  function decorateWinner(winner, discarded) {
    if (!discarded.length) return winner;
    var copy = Object.assign({}, winner);
    copy.qualityFlags = Array.from(new Set((winner.qualityFlags || []).concat(['economic_duplicate_suppressed'])));
    copy.suppressedExposureIds = discarded.map(exposureId).filter(Boolean);
    return copy;
  }

  function dedupe(rows) {
    var source = Array.isArray(rows) ? rows : [];
    var explicitGroups = new Map();
    var candidates = [];
    source.forEach(function (row, index) {
      var id = exposureId(row);
      var explicitKey = id ? [text(row.role), text(row.snapshotDate || row.snapshot_date || row.base_date), id].join('|') : '';
      if (!explicitKey) {
        candidates.push({ row: row, index: index });
        return;
      }
      if (!explicitGroups.has(explicitKey)) explicitGroups.set(explicitKey, []);
      explicitGroups.get(explicitKey).push({ row: row, index: index });
    });

    var suppressed = [];
    explicitGroups.forEach(function (entries) {
      var winner = chooseWinner(entries.map(function (entry) { return entry.row; }));
      var winnerEntry = entries.find(function (entry) { return entry.row === winner; });
      var discarded = entries.filter(function (entry) { return entry !== winnerEntry; });
      candidates.push({ row: decorateWinner(winner, discarded.map(function (entry) { return entry.row; })), index: winnerEntry.index });
      discarded.forEach(function (entry) {
        suppressed.push({
          reason: 'same_exposure_id',
          exposureId: exposureId(entry.row),
          keptExposureId: exposureId(winner),
          role: text(entry.row.role),
          partyId: text(entry.row.partyId || entry.row.party_id),
          partyName: text(entry.row.partyName || entry.row.party_name),
          committedAmount: amount(entry.row.committedAmount),
          currentAmount: amount(entry.row.currentAmount),
          economicKey: economicKey(entry.row)
        });
      });
    });

    var economicGroups = new Map();
    var passthrough = [];
    candidates.forEach(function (entry) {
      var key = economicKey(entry.row);
      if (!key) {
        passthrough.push(entry);
        return;
      }
      if (!economicGroups.has(key)) economicGroups.set(key, []);
      economicGroups.get(key).push(entry);
    });

    economicGroups.forEach(function (entries, key) {
      var markedEntries = entries.filter(function (entry) { return isMarkedDuplicate(entry.row); });
      var retainedEntries = entries.filter(function (entry) { return !isMarkedDuplicate(entry.row); });
      if (entries.length < 2 || !markedEntries.length || !retainedEntries.length) {
        passthrough = passthrough.concat(entries);
        return;
      }
      var winner = chooseWinner(retainedEntries.map(function (entry) { return entry.row; }));
      var winnerEntry = retainedEntries.find(function (entry) { return entry.row === winner; });
      retainedEntries.forEach(function (entry) {
        passthrough.push(entry === winnerEntry
          ? { row: decorateWinner(winner, markedEntries.map(function (marked) { return marked.row; })), index: entry.index }
          : entry);
      });
      markedEntries.forEach(function (entry) {
        suppressed.push({
          reason: 'marked_economic_duplicate',
          exposureId: exposureId(entry.row),
          keptExposureId: exposureId(winner),
          role: text(entry.row.role),
          partyId: text(entry.row.partyId || entry.row.party_id),
          partyName: text(entry.row.partyName || entry.row.party_name),
          committedAmount: amount(entry.row.committedAmount),
          currentAmount: amount(entry.row.currentAmount),
          economicKey: key
        });
      });
    });

    passthrough.sort(function (a, b) { return a.index - b.index; });
    return {
      rows: passthrough.map(function (entry) { return entry.row; }),
      suppressed: suppressed
    };
  }

  return {
    dedupe: dedupe,
    economicKey: economicKey,
    isMarkedDuplicate: isMarkedDuplicate
  };
});
