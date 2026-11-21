import csv
import json

from dotenv import load_dotenv
from openai import OpenAI


def suggest_gl_account(invoice_data: dict, gl_accounts: list) -> list:
    """
    Suggest a GL expense account based on invoice details.
    Only returns accounts from the provided chart of accounts.
    """

    expense_accounts = [
        account for account in gl_accounts
        if account.get("account_type") == "expense"
    ]

    if not expense_accounts:
        return []

    load_dotenv()
    client = OpenAI()

    response = client.responses.create(
        model="gpt-4.1-mini",
        instructions=(
            "You are an accounts payable accounting assistant. "
            "Choose the most appropriate GL expense account for this invoice. "
            "Only select an account from the provided list. "
            "Never invent account numbers. "
            "If the invoice is ambiguous, return null for account_number. "
            "Return only a JSON object with account_number and reason."
        ),
        input="Return the result as JSON.\n" + json.dumps({"invoice": invoice_data,
            "invoice": invoice_data,
            "available_accounts": expense_accounts
        }),
        text={"format": {"type": "json_object"}}
    )

    result = json.loads(response.output_text)

    selected_number = result.get("account_number")

    # Independently verify the AI's choice against the actual accounts.
    matching_account = next(
        (
            account for account in expense_accounts
            if str(account["account_number"]) == str(selected_number)
        ),
        None
    )

    if matching_account is None:
        return []

    return [{
        "account_number": matching_account["account_number"],
        "account_name": matching_account["name"],
        "reason": result.get("reason", ""),
    }]