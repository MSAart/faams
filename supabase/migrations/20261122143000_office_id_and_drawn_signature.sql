alter table public.profiles
  drop constraint if exists profiles_national_id_check;
alter table public.profiles rename column national_id to employee_id;

alter table public.profiles
  add constraint profiles_employee_id_check
    check (
      employee_id is null
      or length(btrim(employee_id)) between 1 and 80
    );
grant update (display_name, employee_id, signature_path) on public.profiles to authenticated;

alter table public.profiles
  drop constraint if exists profiles_signature_path_check,
  add constraint profiles_signature_path_check
    check (
      signature_path is null
      or signature_path ~ (
        '^' || id::text || '/profile/[0-9a-f-]+\.(jpg|png)$'
      )
    );

drop policy if exists faams_evidence_owner_upload on storage.objects;
create policy faams_evidence_owner_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'faams-evidence'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (
      (storage.foldername(name))[2] <> 'profile'
      or (
        name ~ (
          '^' || (select auth.uid()::text) || '/profile/[0-9a-f-]+\.(jpg|png)$'
        )
        and metadata ->> 'mimetype' in ('image/jpeg', 'image/png')
      )
    )
  );

create or replace function public.is_profile_complete()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as profile
     where profile.id = (select auth.uid())
       and nullif(trim(profile.display_name), '') is not null
       and length(trim(coalesce(profile.employee_id, ''))) between 1 and 80
       and nullif(trim(profile.signature_path), '') is not null
  );
$$;
