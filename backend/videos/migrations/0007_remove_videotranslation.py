from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("videos", "0006_videotranslation"),
    ]

    operations = [
        migrations.DeleteModel(
            name="VideoTranslation",
        ),
    ]
