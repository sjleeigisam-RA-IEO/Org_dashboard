import unittest
from datetime import date
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generate_t5t_weekly_summary import reporting_week


class ReportingWeekTests(unittest.TestCase):
    def test_monday_closes_that_reporting_week(self):
        self.assertEqual(
            reporting_week(date(2026, 7, 13)),
            (date(2026, 7, 7), date(2026, 7, 13)),
        )

    def test_tuesday_keeps_the_previous_closed_week(self):
        self.assertEqual(
            reporting_week(date(2026, 7, 14)),
            (date(2026, 7, 7), date(2026, 7, 13)),
        )

    def test_sunday_does_not_select_the_future_monday(self):
        self.assertEqual(
            reporting_week(date(2026, 7, 19)),
            (date(2026, 7, 7), date(2026, 7, 13)),
        )

    def test_next_monday_advances_the_reporting_week(self):
        self.assertEqual(
            reporting_week(date(2026, 7, 20)),
            (date(2026, 7, 14), date(2026, 7, 20)),
        )


if __name__ == "__main__":
    unittest.main()
