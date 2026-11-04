# source me: exports the eval relay (pi's relay-186 channel, non-Claude models only) without printing the key
export CAIRN_EVAL_RELAY_URL=$(python3 -c "import json;print(json.load(open('$HOME/.pi/agent/models.json'))['providers']['relay-186']['baseUrl'])")
export CAIRN_EVAL_RELAY_KEY=$(python3 -c "import json,os;v=json.load(open('$HOME/.pi/agent/models.json'))['providers']['relay-186']['apiKey'];print(os.environ.get(v[1:],'') if v.startswith('\$') else v)")
