-- Allow authenticated users to create organizations
create policy "Users can create organizations"
  on organizations for insert
  to authenticated
  with check (true);
