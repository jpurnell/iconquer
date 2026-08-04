1) It does not look like we need code signing or any specific entitlement to use LanguageModelSession. If we have to, it's find to use a signed Developer ID. The documentation for Foundation Models is here: https://developer.apple.com/documentation/FoundationModels?ref=createwithswift.com

2) Yes, we should check at creation time, and have the user start the session. Actually, could we have the option disabled, and call `ollama serve` with a `start ollama` button that changes state to enabled when Ollama is spun up?

3) Yes, those should move to GamePromptBuilder, that's cleaner anyway

4) Yes, when the user attempts to set up an Ollama model, there should be a dropdown with the available models

5) For now, that's not a problem, but let's offer the flag for future-proofing

6) yes, that's a good recommendation

From all of these questions, I'm thinking we may need a better game setup experience than just flags. It could be of a part and parcel with our map drawing questions. Maybe we do a design proposal about a setup screen and our settings tab to make them both more user-friendly.

