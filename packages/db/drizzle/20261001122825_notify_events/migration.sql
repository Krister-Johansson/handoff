-- Nodes now say what a person should hear about, as notify events, and the notification feed reads only
-- those. Earlier notifications become notify events with the default settings: a run that finished
-- (unless its Finish node had notify off), a node that failed the run, a pull request ready to merge, and
-- a question from a gate. Starts stay quiet by default and are left out. Runs that already have notify
-- events are skipped, so running this again adds nothing.
with legacy as (
  select e.run_id, e.created_at, e.seq as ord, e.node_execution_id,
    jsonb_strip_nulls(case e.type
      when 'run.succeeded' then jsonb_build_object('kind', 'finished')
      when 'run.failed' then jsonb_build_object('kind', 'failed', 'nodeKey', e.payload->'nodeKey', 'reason', e.payload->'reason')
      else jsonb_build_object('kind', 'ready', 'nodeKey', ne.node_key, 'number', e.payload->'number')
    end) as payload
  from events e
  left join node_executions ne on ne.id = e.node_execution_id
  where e.type in ('run.succeeded', 'run.failed', 'merge.ready')
    and not (e.type = 'run.succeeded' and exists (
      select 1 from events f where f.run_id = e.run_id and f.type = 'run.finish' and f.payload->>'notify' = 'false'
    ))
  union all
  select q.run_id, q.created_at, null, q.node_execution_id, jsonb_build_object('kind', 'input', 'nodeKey', ne.node_key, 'questionId', q.id)
  from questions q
  join node_executions ne on ne.id = q.node_execution_id
),
numbered as (
  select l.*, r.next_event_seq + row_number() over (partition by l.run_id order by l.created_at, l.ord nulls last) as seq
  from legacy l
  join runs r on r.id = l.run_id
  where not exists (select 1 from events n where n.run_id = l.run_id and n.type = 'notify')
),
inserted as (
  insert into events (run_id, seq, node_execution_id, type, payload, created_at)
  select run_id, seq, node_execution_id, 'notify', payload, created_at from numbered
  returning run_id
)
update runs set next_event_seq = runs.next_event_seq + added.n
from (select run_id, count(*) as n from inserted group by run_id) added
where runs.id = added.run_id;
