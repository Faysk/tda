-- Expand the presentation-only World layout coordinate envelope for map-scale
-- editorial compositions. The previous ±5,000 boundary was already close to
-- production data and could turn a perfectly valid multi-island layout into
-- invalid_payload merely because the editor used more canvas space.
--
-- Keep the hard finite bound: this remains an input-safety guard, not an
-- invitation to accept unbounded coordinates. No canon/RBAC semantics change.

do $migration$
declare
  v_definition text;
  v_target regprocedure;
  v_old_x text := 'abs((v_position->>''x'')::numeric) > 5000';
  v_old_y text := 'abs((v_position->>''y'')::numeric) > 5000';
  v_new_x text := 'abs((v_position->>''x'')::numeric) > 20000';
  v_new_y text := 'abs((v_position->>''y'')::numeric) > 20000';
begin
  foreach v_target in array array[
    'public.save_world_layout_snapshot_atomic(uuid,uuid,text,bigint,jsonb)'::regprocedure,
    'public.save_world_edit_layout_draft_atomic(uuid,uuid,text,uuid,jsonb)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_target) into v_definition;

    if v_definition is null then
      raise exception 'required World layout function is missing: %', v_target;
    end if;

    if strpos(v_definition, v_old_x) = 0
       or strpos(v_definition, v_old_y) = 0 then
      raise exception 'unexpected World layout coordinate validation in %', v_target;
    end if;

    v_definition := replace(v_definition, v_old_x, v_new_x);
    v_definition := replace(v_definition, v_old_y, v_new_y);
    execute v_definition;
  end loop;
end;
$migration$;

do $verification$
declare
  v_definition text;
  v_target regprocedure;
begin
  foreach v_target in array array[
    'public.save_world_layout_snapshot_atomic(uuid,uuid,text,bigint,jsonb)'::regprocedure,
    'public.save_world_edit_layout_draft_atomic(uuid,uuid,text,uuid,jsonb)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_target) into v_definition;
    if strpos(v_definition, 'abs((v_position->>''x'')::numeric) > 20000') = 0
       or strpos(v_definition, 'abs((v_position->>''y'')::numeric) > 20000') = 0
       or strpos(v_definition, 'abs((v_position->>''x'')::numeric) > 5000') > 0
       or strpos(v_definition, 'abs((v_position->>''y'')::numeric) > 5000') > 0 then
      raise exception 'World layout coordinate envelope verification failed for %', v_target;
    end if;
  end loop;
end;
$verification$;
