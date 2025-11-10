from openai import OpenAI
import argparse
client = OpenAI()

def process_with_constraints(input_text, constraints_file_path): 
    with open(constraints_file_path, 'r') as file:
        constraints = file.read()
    prompt = f"""
    Input: {input_text}
    """
    response = client.responses.create(
        model = "gpt-5-nano",
        instructions = constraints,
        input = prompt
    )
    return response.output_text


parser = argparse.ArgumentParser(description="Evaluate scientific accuracy of input text and return accuracy score and areas of inaccuracy")
parser.add_argument("--input", help="Filepath to input file")
args = parser.parse_args()
with open(args.input, 'r') as inFile:
    with open("LLM_output.txt", 'w') as output:
        output.write(process_with_constraints(inFile.read(), "./LLM_instructions.prompt"))