## Database Cleanup

The current cleanup script is innefficient
it should be refactored to be:

just keep a max # of boards. lets say 250 total.

when a new board is written, if max  boards exist then

delete the oldest last accessed board

## Questions

**Q1: Remove the size limit entirely?**
The current `STORAGE_LIMIT` (100MB) check would become redundant if the
board count is capped at 250. Should it be removed, or kept as a safety
net (e.g. in case a single board is very large)?

**Q2: Cleanup before or after insert?**
If 250 boards exist: delete the oldest first, then insert — or insert
first, then trim to 250? Delete-then-insert avoids ever exceeding the
cap.
