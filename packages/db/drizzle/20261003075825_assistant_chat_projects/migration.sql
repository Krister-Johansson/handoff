-- A chat now belongs to the project of the first page it was asked on that names one. Earlier chats get
-- it from the pages their messages recorded: /projects/<id>/... names the project, /runs/<id>/... names
-- the run's project. A path that names no project, or a project that is gone, leaves the chat without
-- one. Chats that already have a project are left alone, so running this again changes nothing, and
-- updated_at stays as it was, so gc still counts from the chat's last use.
with asked as (
  select m.conversation_id,
    m.created_at,
    substring(m.content->'page'->>'path' from '^/projects/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)') as project_id,
    substring(m.content->'page'->>'path' from '^/runs/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)') as run_id
  from assistant_messages m
  join assistant_conversations c on c.id = m.conversation_id
  where m.role = 'user' and c.project_id is null and m.content->'page'->>'path' is not null
),
named as (
  select distinct on (a.conversation_id) a.conversation_id, coalesce(p.id, r.project_id) as project_id
  from asked a
  left join projects p on p.id = a.project_id::uuid
  left join runs r on r.id = a.run_id::uuid
  where coalesce(p.id, r.project_id) is not null
  order by a.conversation_id, a.created_at
)
update assistant_conversations c
set project_id = named.project_id
from named
where c.id = named.conversation_id and c.project_id is null;
