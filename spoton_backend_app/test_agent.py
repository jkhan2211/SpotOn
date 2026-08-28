# test_agent.py
import sys
sys.path.insert(0, '.')

from agent.spoton_agent import spoton_agent

response = spoton_agent("Is visitor parking available?")
print(response)