import os
from dotenv import load_dotenv

load_dotenv()

from services.email_service import send_permit_confirmation_email

result = send_permit_confirmation_email(
    recipient_email=os.environ["SPOTON_RECIPIENT_EMAIL"],
    permit_id="SP-A8A34A",
    visitor_name="Winnie",
    visitor_plate="ABC123",
    space_id="V01",
    start_time="7:00 PM",
    end_time="10:00 PM",
    available_spaces=4,
    total_spaces=10,
)

print(result)
