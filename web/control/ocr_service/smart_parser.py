import os
import re
from difflib import SequenceMatcher

class SmartParser:
    KILL_WORDS = {'killed', 'knocked', 'stumble', 'headshot', 'bleeding', 'hit', 'shot', 'down', 'out'}

    def __init__(self, dict_file="pubg.words"):
        self.dict_file = dict_file
        self.known_words = set()
        self.load_dictionary()

    def load_dictionary(self):
        """Load known words into a set for fast lookup"""
        if os.path.exists(self.dict_file):
            with open(self.dict_file, 'r', encoding='utf-8') as f:
                for line in f:
                    word = line.strip().split(',')[0].strip() # Handle CSV format "Word, Count"
                    if len(word) > 2:
                        self.known_words.add(word.lower()) # Store as lowercase
        print(f"🧠 SmartParser: Loaded {len(self.known_words)} words.")

    def is_known(self, word):
        """Check if word (or close variation) is in dictionary"""
        # 1. Exact match (fast)
        clean = re.sub(r'[^a-zA-Z0-9]', '', word).lower()
        if not clean: return False
        if clean in self.known_words:
            return True
        
        # 2. Check if it's a substring of a known word (for split parts like "FaZe" in "FaZeClan")
        # Optimization: Only check this if short? No, keep simple.
        # Actually simplest is just containment in set.
        return False

    def add_word(self, word):
        """Dynamically learn a new word and save to file"""
        clean = re.sub(r'[^a-zA-Z0-9]', '', word).lower()
        if len(clean) > 2:
            if clean not in self.known_words:
                self.known_words.add(clean)
                try:
                    with open(self.dict_file, "a", encoding="utf-8") as f:
                        f.write(f"{word}\n")
                    return True
                except Exception as e:
                    print(f"❌ Failed to save word: {e}")
        return False

    def parse(self, text):
        """
        AI Parsing: Uses known dictionary words to identify Killer and Victim clusters,
        ignoring whatever garbage/icon is in the middle.
        Returns: (killer, victim) or (None, None)
        """
        # Split by spaces
        tokens = text.split()
        if len(tokens) < 3: return None, None # Need at least "A killed B"
        
        # Tag tokens: 1=Known, 0=Unknown
        # We also treat very long alphanumeric strings as "Likely Name" even if not in dict
        tags = []
        for t in tokens:
            if len(t) < 2: 
                tags.append(0) # Skip single chars
                continue
                
            if self.is_known(t):
                tags.append(1)
            elif t.lower() in self.KILL_WORDS:
                tags.append(2) # KNOWN SEPARATOR
            elif re.match(r'^[a-zA-Z0-9]{3,}$', t): 
                # Looks like a name (clean alphanumeric), tentatively treat as usable
                tags.append(1) 
            else:
                tags.append(0) # Symbol/Garbage
        
        # Now look for pattern: [Name Group] [Gap] [Name Group]
        # Example: 1 1 0 1 1  -> [1 1] gap [1 1]
        
        # Find the largest "Gap" of 0s in the middle? 
        # Or better: Find specific transition from 1 to 0 to 1
        
        # Simple heuristic: Split mostly in half, but respecting the "Unknown" barrier?
        
        # If we have a sequence of 1s, then 0s (or 2s), then 1s.
        if 0 in tags or 2 in tags:
            # Find the indices of 0s (potential icons) or 2s (known separators)
            
            # Grouping contiguous 1s (Names)
            groups = []
            current_group = []
            
            for i, tag in enumerate(tags):
                if tag == 1:
                    current_group.append(tokens[i])
                else: 
                    # 0 or 2 = Separator/Garbage
                    if current_group:
                        groups.append(" ".join(current_group))
                        current_group = []
            
            if current_group: groups.append(" ".join(current_group))
            
            # If we explicitly found a Tag 2 (Kill Word), use it as the pivot
            if 2 in tags:
                idx = tags.index(2)
                # Killer is everything before, Victim is after
                # We also strip garbage from edges if needed, but simplistic approach first:
                k_tokens = tokens[:idx]
                v_tokens = tokens[idx+1:]
                
                # Filter out pure symbols from ends?
                killer = " ".join(k_tokens).strip()
                victim = " ".join(v_tokens).strip()
                
                if killer and victim:
                    return killer, victim

            # If we found exactly 2 groups of names separated by garbage, that's our match!
            if len(groups) == 2:
                return groups[0], groups[1]
                
            # Fallback: First group is killer, Last group is victim
            # This handles cases like [Name] [Icon] [Name] [Gun]
            if len(groups) >= 2:
                # Heuristic: The icon is usually in the middle.
                return groups[0], groups[-1] 

        return None, None
