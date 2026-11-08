from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("videos", "0004_videoanalysis"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="video",
            name="analysis_status",
        ),
        migrations.DeleteModel(
            name="VideoAnalysis",
        ),
    ]
