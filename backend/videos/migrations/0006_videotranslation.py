from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("videos", "0005_remove_video_analysis"),
    ]

    operations = [
        migrations.CreateModel(
            name="VideoTranslation",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("source_digest", models.CharField(max_length=64)),
                ("source_language", models.CharField(blank=True, max_length=35)),
                ("target_language", models.CharField(max_length=10)),
                ("segments", models.JSONField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "video",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="translations",
                        to="videos.video",
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="videotranslation",
            constraint=models.UniqueConstraint(
                fields=("video", "source_digest", "target_language"),
                name="unique_video_transcript_translation",
            ),
        ),
    ]
