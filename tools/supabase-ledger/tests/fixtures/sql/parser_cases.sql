CREATE TABLE "Odd Schema"."Case Sensitive" (
  id uuid PRIMARY KEY
);

CREATE FUNCTION public.example_body()
RETURNS text
LANGUAGE plpgsql
AS $body$
BEGIN
  RETURN 'CREATE TABLE fake_table (id integer);';
END;
$body$;
