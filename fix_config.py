import subprocess
key = subprocess.run(['pbpaste'], capture_output=True, text=True).stdout.strip()
print('Key length:', len(key), '| Starts:', key[:15])
content = "window.ARCKO_CONFIG = {\n  SUPABASE_URL: 'https://nhnbtxarjnpuseykhirl.supabase.co',\n  SUPABASE_ANON_KEY: '" + key + "'\n};\n"
open('config.js', 'w').write(content)
print('Written OK')
