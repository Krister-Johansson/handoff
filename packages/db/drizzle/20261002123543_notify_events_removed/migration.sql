-- Notifications are rows in the notifications table now, written by whoever sends them. The notify
-- events that carried them before are removed; the new table starts empty. A run's other events keep
-- their numbers, so its log has gaps where a notify event was, and new events continue after the last.
delete from events where type = 'notify';
