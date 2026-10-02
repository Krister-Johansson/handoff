-- A notification now carries the title and the body its node wrote, and the feed shows them as they are.
-- Earlier notifications get the text the feed wrote for them when it read them: the project and what
-- happened as the title, and the run's task, the question's summary or the question, or what a permission
-- request asked for as the body, on one line and cut to 140 characters. Notifications that already have
-- a title are left alone, so running this again changes nothing.
with told as (
  select e.id,
    p.name as project,
    e.payload->>'kind' as kind,
    e.payload->>'nodeKey' as node_key,
    e.payload->>'reason' as reason,
    coalesce(e.payload->>'number', '?') as number,
    r.task,
    q.question,
    q.context,
    pr.tool_name,
    pr.input
  from events e
  join runs r on r.id = e.run_id
  join projects p on p.id = r.project_id
  left join questions q on q.id = (e.payload->>'questionId')::uuid
  left join permission_requests pr on pr.id = (e.payload->>'requestId')::uuid
  where e.type = 'notify' and e.payload->>'title' is null
),
written as (
  select id,
    project || ': ' || case kind
      when 'failed' then case
        when reason = 'loop_exhausted' then coalesce(node_key, 'a step') || ' ran out of rounds'
        when node_key is not null then 'run failed at ' || node_key
        else 'run failed'
      end
      when 'ready' then 'PR #' || number || ' is ready to merge'
      when 'merged' then 'PR #' || number || ' merged'
      when 'permission' then coalesce(node_key, 'a step') || ' ' || case
        when tool_name = 'Bash' then 'asks to run a command'
        when tool_name in ('Edit', 'Write', 'NotebookEdit') then 'asks to change a file'
        when tool_name = 'WebFetch' then 'asks to fetch a page'
        when tool_name = 'WebSearch' then 'asks to search the web'
        else 'asks to use ' || coalesce(tool_name, 'a tool')
      end
      when 'input' then case
        when context->>'reason' = 'try' then 'the app is ready for you to try'
        when context->'review' is not null then 'the ' || coalesce(context#>>'{review,kind}', 'work') || ' from ' || coalesce(context#>>'{review,from}', 'a step') || ' needs your review'
        else coalesce(node_key, 'a gate') || ' asks a question'
      end
      else 'run ' || kind
    end as title,
    regexp_replace(btrim(coalesce(
      case kind
        when 'permission' then nullif(case
          when tool_name = 'Bash' then input->>'command'
          when tool_name in ('Edit', 'Write', 'NotebookEdit') then coalesce(input->>'file_path', input->>'notebook_path')
          when tool_name = 'WebFetch' then input->>'url'
          when tool_name = 'WebSearch' then input->>'query'
          else input::text
        end, '')
        when 'input' then case
          when context->>'reason' = 'try' or context->'review' is not null then null
          else coalesce(nullif(btrim(context->>'summary'), ''), question)
        end
      end,
      task
    )), '\s+', ' ', 'g') as line
  from told
)
update events e
set payload = e.payload || jsonb_build_object(
  'title', w.title,
  'body', case
    when length(w.line) <= 140 then w.line
    else regexp_replace(regexp_replace(left(w.line, 139), '\s\S*$', ''), '[\s.,;:]+$', '') || '…'
  end
)
from written w
where e.id = w.id;
