(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuarterlyLifecycle = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function dateText(value) {
    var text = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isoDate(year, month, day) {
    return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
  }

  function quarterRange(year, quarter) {
    var startMonth = (quarter - 1) * 3 + 1;
    var endMonth = startMonth + 2;
    var endDay = new Date(year, endMonth, 0).getDate();
    return {
      start: isoDate(year, startMonth, 1),
      end: isoDate(year, endMonth, endDay)
    };
  }

  function dedupeFunds(funds, amountOf) {
    var byId = new Map();
    (funds || []).forEach(function (fund, index) {
      if (!fund) return;
      var key = String(fund.fund_id || fund.id || 'row-' + index);
      var previous = byId.get(key);
      if (!previous || amountOf(fund) > amountOf(previous)) byId.set(key, fund);
    });
    return Array.from(byId.values());
  }

  function buildEventItems(funds, start, end, dateOf, amountOf, nameOf) {
    return funds.map(function (fund) {
      return {
        fund: fund,
        id: String(fund.fund_id || fund.id || ''),
        name: String(nameOf(fund) || fund.fund_id || '명칭 미상'),
        date: dateText(dateOf(fund)),
        amount: Math.max(0, number(amountOf(fund))),
        vehicle: String(fund.notion_vehicle_class || fund.vehicle_type || ''),
        status: String(fund.aum_status || fund.status || '')
      };
    }).filter(function (item) {
      return item.date && item.date >= start && item.date <= end;
    }).sort(function (a, b) {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.amount !== b.amount) return b.amount - a.amount;
      return a.name.localeCompare(b.name, 'ko');
    });
  }

  function buildModel(funds, snapshotValue, options) {
    var config = options || {};
    var snapshot = dateText(snapshotValue);
    if (!snapshot) throw new Error('A valid snapshot date is required.');

    var year = Number(snapshot.slice(0, 4));
    var snapshotMonth = Number(snapshot.slice(5, 7));
    var snapshotDay = Number(snapshot.slice(8, 10));
    var include = config.include || function () { return true; };
    var setupDateOf = config.setupDateOf || function (fund) { return fund.setup_date; };
    var liquidationDateOf = config.liquidationDateOf || function (fund) { return fund.liquidation_date; };
    var amountOf = config.amountOf || function (fund) { return fund.benchmark_aum; };
    var nameOf = config.nameOf || function (fund) { return fund.short_name || fund.fund_name; };
    var eligible = dedupeFunds((funds || []).filter(include), amountOf);

    var quarters = [1, 2, 3, 4].map(function (quarter) {
      var range = quarterRange(year, quarter);
      var state = snapshot >= range.end ? 'complete' : (snapshot >= range.start ? 'current' : 'future');
      var effectiveEnd = state === 'current' ? snapshot : range.end;
      var setup = state === 'future' ? [] : buildEventItems(
        eligible, range.start, effectiveEnd, setupDateOf, amountOf, nameOf
      );
      var liquidation = state === 'future' ? [] : buildEventItems(
        eligible, range.start, effectiveEnd, liquidationDateOf, amountOf, nameOf
      );
      return {
        quarter: quarter,
        title: quarter + '분기',
        state: state,
        statusLabel: state === 'complete' ? '마감' : (state === 'current' ? snapshotMonth + '월말 기준' : '미도래'),
        start: range.start,
        end: effectiveEnd,
        scheduledEnd: range.end,
        setup: setup,
        liquidation: liquidation,
        setupAmount: setup.reduce(function (sum, item) { return sum + item.amount; }, 0),
        liquidationAmount: liquidation.reduce(function (sum, item) { return sum + item.amount; }, 0)
      };
    });

    var current = quarters.find(function (item) { return item.state === 'current'; });
    var completed = quarters.filter(function (item) { return item.state === 'complete'; });
    return {
      year: year,
      snapshotDate: snapshot,
      snapshotMonth: snapshotMonth,
      snapshotDay: snapshotDay,
      defaultQuarter: current ? current.quarter : (completed.length ? completed[completed.length - 1].quarter : 1),
      quarters: quarters
    };
  }

  return {
    buildModel: buildModel,
    dateText: dateText,
    quarterRange: quarterRange
  };
});
