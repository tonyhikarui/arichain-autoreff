def read_email_from_register():
    """Read emails from register.txt"""
    try:
        with open('config/register.txt', 'r') as f:
            return {line.split(':')[0].strip() for line in f if ':' in line}
    except FileNotFoundError:
        print("register.txt not found")
        return set()

def read_email_from_accounts():
    """Read successful emails from accounts.txt"""
    try:
        with open('result/accounts.txt', 'r') as f:
            lines = f.readlines()
            return {line.split(': ')[1].strip() for line in lines if line.startswith('Email:')}
    except FileNotFoundError:
        print("accounts.txt not found")
        return set()

def save_unused_accounts(unused_emails):
    """Save unused accounts to unused_accounts.txt"""
    try:
        with open('config/register.txt', 'r') as f:
            accounts = {line.split(':')[0].strip(): line.strip() for line in f if ':' in line}
            
        with open('config/unused_accounts.txt', 'w') as f:
            for email in unused_emails:
                if email in accounts:
                    f.write(f"{accounts[email]}\n")
        print(f"Saved {len(unused_emails)} unused accounts to unused_accounts.txt")
    except Exception as e:
        print(f"Error saving unused accounts: {e}")

def main():
    # Read emails from both files
    register_emails = read_email_from_register()
    used_emails = read_email_from_accounts()

    # Find emails that are in register.txt but not in accounts.txt
    unused_emails = register_emails - used_emails
    
    # Print summary
    print(f"Total accounts in register.txt: {len(register_emails)}")
    print(f"Successfully used accounts: {len(used_emails)}")
    print(f"Unused accounts: {len(unused_emails)}")

    # Save unused accounts
    if unused_emails:
        save_unused_accounts(unused_emails)

if __name__ == "__main__":
    main()
