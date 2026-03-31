# GCI-Extension

## Warning: This is a deprecated version! Navigate to the updated-version branch for instructions and source code for the current version! 

## How to Run Chrome Extension
- Download source code and unzip into a folder
- In the Chrome browser, click the extensions button and navigate to `Manage Extensions`
- Enable `Developer Mode` for extensions
- Click `Load Unpacked` and select the folder the source code is stored in
- Navigate to a webpage and click the TruthForge extension icon
- From the popup, choose validate or investigate to apply different heuristic evaluations to the webpage content

## How to Use OpenAI API Call
With the OpenAI Python library installed, run `python3 gci.py --input inputFile`. Script requires OpenAI API Key to run. The script will output a text file `LLM_output.txt`.

## LLM Output Format
Output format for text file is given in `LLM_instructions.prompt`

## Known Errors
- When running the extension, a faulty error message is returned (this is not indicative of an actual error)
